#!/usr/bin/env python3
import json
import re
import time
from dataclasses import dataclass
from deep_translator import GoogleTranslator

EN_PATH = '/Applications/Claude.app/Contents/Resources/ion-dist/i18n/en-US.json'
ZH_PATH = '/Applications/Claude.app/Contents/Resources/ion-dist/i18n/zh-CN.json'

CJK_RE = re.compile(r'[\u4e00-\u9fff]')
LETTER_RE = re.compile(r'[A-Za-z]')
PLACEHOLDER_RE = re.compile(r'\{[^{}\n]*\}')
URL_ONLY_RE = re.compile(r'^https?://', re.I)

TOKEN_PATTERNS = [
    re.compile(r'</?[^<>\n]+?>'),
    re.compile(r'`[^`\n]*`'),
    re.compile(r'%\d*\$?[sdif]'),
]

ICU_TYPES = {'plural', 'select', 'selectordinal'}


def should_refine(en_text: str, zh_text: str) -> bool:
    if zh_text == en_text:
        return True
    if (not CJK_RE.search(zh_text)) and LETTER_RE.search(zh_text):
        return True
    return False


def protect_tokens(text: str):
    tokens = []
    out = text
    for pat in TOKEN_PATTERNS:
        while True:
            m = pat.search(out)
            if not m:
                break
            tok = f'ZHTOK{len(tokens):04d}TOK'
            tokens.append(m.group(0))
            out = out[:m.start()] + tok + out[m.end():]
    return out, tokens


def restore_tokens(text: str, tokens):
    out = text
    for i, src in enumerate(tokens):
        tok = f'ZHTOK{i:04d}TOK'
        if tok not in out:
            return None
        out = out.replace(tok, src)
    return out


class Translator:
    def __init__(self):
        self.tr = GoogleTranslator(source='en', target='zh-CN')

    def t(self, s: str) -> str:
        if not s.strip():
            return s
        if URL_ONLY_RE.match(s.strip()):
            return s
        protected, toks = protect_tokens(s)
        last_err = None
        for _ in range(5):
            try:
                out = self.tr.translate(protected)
                restored = restore_tokens(out, toks)
                if restored is None:
                    return s
                return restored
            except Exception as e:
                last_err = e
                time.sleep(0.6)
        return s


@dataclass
class Block:
    kind: str  # 'text' or 'brace'
    text: str


def split_top_level(s: str):
    res = []
    i = 0
    n = len(s)
    buf = []
    while i < n:
        ch = s[i]
        if ch == '{':
            if buf:
                res.append(Block('text', ''.join(buf)))
                buf = []
            start = i
            depth = 1
            i += 1
            while i < n and depth > 0:
                if s[i] == '{':
                    depth += 1
                elif s[i] == '}':
                    depth -= 1
                i += 1
            if depth == 0:
                res.append(Block('brace', s[start:i]))
            else:
                # malformed, treat remaining as text
                buf.append(s[start:])
                break
            continue
        else:
            buf.append(ch)
            i += 1
    if buf:
        res.append(Block('text', ''.join(buf)))
    return res


def parse_icu_header(inner: str):
    # name, type, rest
    i = 0
    n = len(inner)
    while i < n and inner[i].isspace():
        i += 1
    j = i
    while j < n and (inner[j].isalnum() or inner[j] in '_-'):
        j += 1
    if j == i:
        return None
    name = inner[i:j]
    k = j
    while k < n and inner[k].isspace():
        k += 1
    if k >= n or inner[k] != ',':
        return None
    k += 1
    while k < n and inner[k].isspace():
        k += 1
    t0 = k
    while k < n and (inner[k].isalpha()):
        k += 1
    typ = inner[t0:k]
    if typ not in ICU_TYPES:
        return None
    while k < n and inner[k].isspace():
        k += 1
    if k >= n or inner[k] != ',':
        return None
    rest = inner[k+1:]
    return name, typ, rest


def parse_icu_options(rest: str):
    # selector {message} pairs
    i = 0
    n = len(rest)
    out = []
    while i < n:
        while i < n and rest[i].isspace():
            i += 1
        if i >= n:
            break
        s0 = i
        while i < n and (not rest[i].isspace()) and rest[i] != '{':
            i += 1
        selector = rest[s0:i]
        while i < n and rest[i].isspace():
            i += 1
        if i >= n or rest[i] != '{':
            return None
        i += 1
        depth = 1
        m0 = i
        while i < n and depth > 0:
            if rest[i] == '{':
                depth += 1
            elif rest[i] == '}':
                depth -= 1
            i += 1
        if depth != 0:
            return None
        msg = rest[m0:i-1]
        out.append((selector, msg))
    return out


def translate_message(msg: str, tr: Translator) -> str:
    parts = split_top_level(msg)
    out = []
    for p in parts:
        if p.kind == 'text':
            out.append(tr.t(p.text))
            continue

        brace = p.text
        inner = brace[1:-1]
        parsed = parse_icu_header(inner)
        if not parsed:
            out.append(brace)
            continue

        name, typ, rest = parsed
        opts = parse_icu_options(rest)
        if opts is None:
            out.append(brace)
            continue

        new_opts = []
        for sel, submsg in opts:
            new_sub = translate_message(submsg, tr)
            new_opts.append((sel, new_sub))

        rebuilt = '{' + name + ', ' + typ + ', ' + ' '.join([f'{sel} {{{sub}}}' for sel, sub in new_opts]) + '}'
        out.append(rebuilt)

    return ''.join(out)


def main():
    with open(EN_PATH, 'r', encoding='utf-8') as f:
        en = json.load(f)
    with open(ZH_PATH, 'r', encoding='utf-8') as f:
        zh = json.load(f)

    tr = Translator()
    keys = [k for k, v in en.items() if isinstance(v, str) and isinstance(zh.get(k, ''), str) and should_refine(v, zh[k])]

    print(f'remaining_before={len(keys)}', flush=True)

    changed = 0
    for idx, k in enumerate(keys, start=1):
        src = en[k]
        old = zh[k]
        new = translate_message(src, tr)
        # preserve placeholders invariants
        if sorted(PLACEHOLDER_RE.findall(src)) != sorted(PLACEHOLDER_RE.findall(new)):
            new = old
        if new != old:
            zh[k] = new
            changed += 1

        if idx % 50 == 0:
            print(f'progress {idx}/{len(keys)} changed={changed}', flush=True)

    with open(ZH_PATH, 'w', encoding='utf-8') as f:
        json.dump(zh, f, ensure_ascii=False, indent=2)
        f.write('\n')

    # post stats
    remain_after = 0
    for k, v in en.items():
        zv = zh.get(k, '')
        if isinstance(v, str) and isinstance(zv, str) and should_refine(v, zv):
            remain_after += 1

    mismatch = 0
    for k, v in en.items():
        if isinstance(v, str) and isinstance(zh.get(k, ''), str):
            if sorted(PLACEHOLDER_RE.findall(v)) != sorted(PLACEHOLDER_RE.findall(zh[k])):
                mismatch += 1

    print(f'changed={changed} remaining_after={remain_after} placeholder_mismatch={mismatch}', flush=True)


if __name__ == '__main__':
    main()
