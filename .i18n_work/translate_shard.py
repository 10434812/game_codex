#!/usr/bin/env python3
import json
import re
import sys
import time
from deep_translator import GoogleTranslator

TOKEN_PATTERNS = [
    re.compile(r"\{[^{}\n]*\}"),
    re.compile(r"</?[^<>\n]+?>"),
    re.compile(r"%\d*\$?[sdif]"),
    re.compile(r"`[^`\n]*`"),
]
COMPLEX_ICU = re.compile(r"\{\s*\w+\s*,\s*(plural|select|selectordinal)\s*,", re.I)
URL_ONLY = re.compile(r"^https?://", re.I)


def protect(text):
    tokens = []
    out = text
    for pat in TOKEN_PATTERNS:
        while True:
            m = pat.search(out)
            if not m:
                break
            tok = f"ZXQPH{len(tokens):04d}QXZ"
            tokens.append(m.group(0))
            out = out[:m.start()] + tok + out[m.end():]
    return out, tokens


def restore(text, tokens):
    out = text
    for i, src in enumerate(tokens):
        tok = f"ZXQPH{i:04d}QXZ"
        if tok not in out:
            return None
        out = out.replace(tok, src)
    return out


def should_skip(core):
    s = core.strip()
    if not s:
        return True
    if URL_ONLY.match(s):
        return True
    if COMPLEX_ICU.search(core):
        return True
    return False


def translate_one(tr, text):
    lead_len = len(text) - len(text.lstrip())
    trail_len = len(text) - len(text.rstrip())
    lead = text[:lead_len]
    core = text[lead_len:len(text)-trail_len if trail_len else len(text)]
    trail = text[len(text)-trail_len:] if trail_len else ""

    if should_skip(core):
        return text, "skipped"

    ptxt, tokens = protect(core)
    out_lines = []
    for line in ptxt.split("\n"):
        if not line.strip():
            out_lines.append(line)
            continue
        ok = False
        last_err = None
        for _ in range(4):
            try:
                out_lines.append(tr.translate(line))
                ok = True
                break
            except Exception as e:
                last_err = e
                time.sleep(0.7)
        if not ok:
            return text, "failed"
    translated = "\n".join(out_lines)
    restored = restore(translated, tokens)
    if restored is None:
        return text, "fallback"

    return f"{lead}{restored}{trail}", "translated"


def main(inp, outp):
    items = json.load(open(inp, 'r', encoding='utf-8'))
    tr = GoogleTranslator(source='en', target='zh-CN')
    result = {}
    stat = {'translated':0,'skipped':0,'fallback':0,'failed':0}
    for i, item in enumerate(items, start=1):
        k = item['key']
        v = item['en']
        z, s = translate_one(tr, v)
        result[k] = z
        stat[s] += 1
        if i % 80 == 0:
            print(f"{inp} {i}/{len(items)} {stat}", flush=True)
    with open(outp, 'w', encoding='utf-8') as f:
        json.dump({'translations': result, 'stat': stat, 'count': len(items)}, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f"done {inp} -> {outp} stat={stat}", flush=True)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('usage: translate_shard.py <input.json> <output.json>')
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
