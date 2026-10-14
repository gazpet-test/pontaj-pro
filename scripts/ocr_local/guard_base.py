"""Garda semantica v3 (copiata din pipeline-ul Codex 0.1.0, neschimbata ca logica).
Singura schimbare: tokenizer-ul vine din protocol.json (cale + SHA-256), nu dintr-o cale relativa la folderul Codex."""
from collections import Counter
import hashlib, json, pathlib

PROTOCOL = pathlib.Path(__file__).parent / 'protocol.json'
_TOK = None

def tokenizer():
    global _TOK
    if _TOK is None:
        from tokenizers import Tokenizer
        cfg = json.loads(PROTOCOL.read_text(encoding='utf-8'))['guard_tokenizer']
        path = pathlib.Path(cfg['path'])
        if hashlib.sha256(path.read_bytes()).hexdigest().lower() != cfg['sha256'].lower():
            raise RuntimeError('Tokenizer-ul garzii are alt SHA-256 decat protocol.json')
        _TOK = Tokenizer.from_file(str(path))
    return _TOK

class Guard:
 def __init__(self):
  self.reset()
 def reset(self):self.scanned=0;self.counts=Counter();self.last_tokens_chars=0;self.event=None
 def __call__(self,text):
  for i in range(self.scanned,max(0,len(text)-199)):
   block=text[i:i+200];self.counts[block]+=1
   if self.counts[block]>=4:
    self.event={'reason':'bucla_repeated200_ge4','characters':len(text),'window_start':i,'block_sha256':hashlib.sha256(block.encode()).hexdigest(),'occurrences':self.counts[block]};return self.event['reason']
  self.scanned=max(0,len(text)-199)
  if len(text)-self.last_tokens_chars>=128:
   self.last_tokens_chars=len(text)
   # Tokenizer-ul se incarca doar cand textul e destul de lung ca regula sa poata declansa (>3000 tokeni).
   if len(text)>3000 and len(set(text))<100:
    n=len(tokenizer().encode(text,add_special_tokens=False).ids)
    if n>3000:
     self.event={'reason':'bucla_unique_chars_lt100_after3000tokens','characters':len(text),'retokenized_count':n,'unique_chars':len(set(text)),'count_basis':'same local tokenizer on decoded text; may differ from generation token boundaries','check_interval_chars':128};return self.event['reason']
  return None
