#!/usr/bin/env python3
import json,re
en='/Applications/Claude.app/Contents/Resources/ion-dist/i18n/en-US.json'
zh='/Applications/Claude.app/Contents/Resources/ion-dist/i18n/zh-CN.json'
with open(en,'r',encoding='utf-8') as f: E=json.load(f)
with open(zh,'r',encoding='utf-8') as f: Z=json.load(f)
pat=re.compile(r'\{[^{}\n]*\}')
cjk=re.compile(r'[\u4e00-\u9fff]')
letters=re.compile(r'[A-Za-z]')
mis=0
remain=0
for k,v in E.items():
    z=Z.get(k,'')
    if isinstance(v,str) and isinstance(z,str):
        if sorted(pat.findall(v))!=sorted(pat.findall(z)):
            mis+=1
        if z==v or (not cjk.search(z) and letters.search(z)):
            remain+=1
print('placeholder_mismatch',mis)
print('possible_english_remaining',remain)
