"""012: immutable raw output, empty-cell-collapsed detection view only."""
import re, html, hashlib, collections
from .guard_base import Guard as PriorGuard
from .guard_legacy import repetition_reason, repeated_table_row
VERSION='empty-cells-v5-td-consecutive-rawrows-pipelineimg'
POLICY={'last_cells_without_nonempty':600,'repeated_block_chars':200,'repeated_block_occurrences':4,'diversity_tokens_gt':3000,'diversity_chars_lt':100}
CELL=re.compile(r'<td\b([^>]*)>(.*?)</td\s*>',re.I|re.S)
MARK=''
# Decupajele puse de pipeline-ul MinerU (mineru_vl_utils: mask_and_encode_table_image -> replace_table_image_tokens) apar ca
# <img src="data:image/jpeg;base64,..."/>: zeci de KB cu ~65 de caractere distincte -> unique_chars suna fals.
# Scutirea e pe PROVENIENTA: `imagini` = payload-urile inregistrate la codificare (read.read_mineru), fiecare scos din vedere de cel mult
# atatea ori de cate a fost codificat. Fara inregistrare (LightOn, alta versiune a bibliotecii) nu se scoate nimic (= v4).
IMG_PIPELINE=re.compile(r'<img src="data:image/jpeg;base64,([A-Za-z0-9+/]+={0,2})"/>')
def empty(m):
 # Strict whitespace/entity-only body; nested markup and semantic attributes stay.
 return not re.search(r'\b(?:title|alt|aria-label|data-value)\s*=',m[1],re.I) and not html.unescape(m[2]).strip()
def view(text,imagini=None):
 n_img=0
 if imagini:
  ramase=collections.Counter(imagini)
  def scoate(m):
   nonlocal n_img
   if ramase[m[1]]<=0:return m[0]
   ramase[m[1]]-=1;n_img+=1;return '<img src="data:image/jpeg;base64,"/>'
  text=IMG_PIPELINE.sub(scoate,text)
 cells=list(CELL.finditer(text)); flags=[empty(m) for m in cells]
 masked=CELL.sub(lambda m:MARK if empty(m) else m[0],text)
 # Collapse adjacent empty cells across structural row boundaries, including
 # empty rows. Preserve every nonempty cell verbatim, including zero/dash.
 gap=r'(?:\s|\\n|\\r|\\t|</?tr\b[^>]*>)*'
 masked=re.sub(MARK+r'(?:'+gap+MARK+r')+',MARK,masked,flags=re.I)
 return masked,{'complete_cells':len(cells),'empty_cells':sum(flags),'last600_all_empty':len(flags)>=600 and all(flags[-600:]),'collapsed_markers':masked.count(MARK),'pipeline_images_stripped':n_img}
class Guard:
 def __init__(self,imagini=()):self.imagini=collections.Counter(imagini);self.semantic=PriorGuard();self.reset()
 def reset(self):self.semantic.reset();self.previous='';self.event=None;self.stats={}
 def __call__(self,text):
  filtered,self.stats=view(text,self.imagini)
  reason=None;event=None
  if self.stats['last600_all_empty']:
   reason='celule_goale_fara_continut';event={'reason':reason}
  else:
   if not filtered.startswith(self.previous):self.semantic.reset()
   self.previous=filtered;reason=self.semantic(filtered);event=self.semantic.event
   if not reason:
    old=repetition_reason(filtered) or repeated_table_row(text)  # randurile: pe textul brut
    if old:reason='bucla_previous_guard';event={'reason':reason,'detail':old}
  if reason:
   self.event={**(event or {}),'reason':reason,'view_stats':self.stats,'view_sha256':hashlib.sha256(filtered.encode()).hexdigest(),'guard_version':VERSION}
  return reason
