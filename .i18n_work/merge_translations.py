#!/usr/bin/env python3
import json,re,sys

EN='/Applications/Claude.app/Contents/Resources/ion-dist/i18n/en-US.json'
ZH='/Applications/Claude.app/Contents/Resources/ion-dist/i18n/zh-CN.json'
PAT=re.compile(r'\{[^{}\n]*\}')

outs=[
 '/Users/hh/Desktop/game_codex/.i18n_work/out_1.json',
 '/Users/hh/Desktop/game_codex/.i18n_work/out_2.json',
 '/Users/hh/Desktop/game_codex/.i18n_work/out_3.json',
 '/Users/hh/Desktop/game_codex/.i18n_work/out_4.json',
]

with open(EN,'r',encoding='utf-8') as f: en=json.load(f)
with open(ZH,'r',encoding='utf-8') as f: zh=json.load(f)

merged={}
for p in outs:
    with open(p,'r',encoding='utf-8') as f:
        d=json.load(f)
    merged.update(d['translations'])

applied=0
rejected=0
for k,v in merged.items():
    src=en.get(k)
    if not isinstance(src,str) or not isinstance(v,str):
        rejected+=1
        continue
    if sorted(PAT.findall(src)) != sorted(PAT.findall(v)):
        rejected+=1
        continue
    zh[k]=v
    applied+=1

with open(ZH,'w',encoding='utf-8') as f:
    json.dump(zh,f,ensure_ascii=False,indent=2)
    f.write('\n')

# final check
mismatch=0
for k,v in en.items():
    if isinstance(v,str) and isinstance(zh.get(k,''),str):
        if sorted(PAT.findall(v)) != sorted(PAT.findall(zh[k])):
            mismatch+=1

print(f'applied={applied} rejected={rejected} total_merged={len(merged)} mismatch_after={mismatch}')
