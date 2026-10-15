"""012: immutable raw output, empty-cell-collapsed detection view only."""
import re, html, hashlib, base64, io
from .guard_base import Guard as PriorGuard
from .guard_legacy import repetition_reason, repeated_table_row
VERSION='empty-cells-v5-td-consecutive-rawrows-pipelineimg'
POLICY={'last_cells_without_nonempty':600,'repeated_block_chars':200,'repeated_block_occurrences':4,'diversity_tokens_gt':3000,'diversity_chars_lt':100}
CELL=re.compile(r'<td\b([^>]*)>(.*?)</td\s*>',re.I|re.S)
MARK=''
# Imaginile puse de pipeline-ul MinerU (mineru_vl_utils, table_image_processor.replace_table_image_tokens): decupajul din banda,
# JPEG, exact in forma <img src="data:image/jpeg;base64,..."/>. Zeci de KB cu ~65 de caractere distincte -> unique_chars suna fals.
# Scutirea e pe PROVENIENTA, nu pe forma: vederea scoate doar payload-urile primite in `imagini` (vezi imagini_pipeline).
IMG_PIPELINE=re.compile(r'<img src="data:image/jpeg;base64,([A-Za-z0-9+/]+={0,2})"/>')
def imagini_pipeline(text, marime_banda):
 """Payload-urile din `text` care sunt imagini JPEG reale: base64 strict, decodare completa, cel mult cat banda (lungime, latime).
 Doar pe calea MinerU (decupaje din imaginea benzii). Un sir generat de model (ex. o bucla „QUJD...”) nu trece decodarea JPEG."""
 from PIL import Image
 ok=set()
 for m in IMG_PIPELINE.finditer(text):
  try:
   with Image.open(io.BytesIO(base64.b64decode(m[1],validate=True))) as im:
    if im.format!='JPEG' or im.width>marime_banda[0] or im.height>marime_banda[1]:continue
    im.load()  # JPEG trunchiat / corupt -> exceptie
  except Exception:continue
  ok.add(m[1])
 return frozenset(ok)
def empty(m):
 # Strict whitespace/entity-only body; nested markup and semantic attributes stay.
 return not re.search(r'\b(?:title|alt|aria-label|data-value)\s*=',m[1],re.I) and not html.unescape(m[2]).strip()
def view(text,imagini=frozenset()):
 n_img=0
 if imagini:
  def scoate(m):
   nonlocal n_img
   if m[1] not in imagini:return m[0]
   n_img+=1;return '<img src="data:image/jpeg;base64,"/>'
  text=IMG_PIPELINE.sub(scoate,text)
 cells=list(CELL.finditer(text)); flags=[empty(m) for m in cells]
 masked=CELL.sub(lambda m:MARK if empty(m) else m[0],text)
 # Collapse adjacent empty cells across structural row boundaries, including
 # empty rows. Preserve every nonempty cell verbatim, including zero/dash.
 gap=r'(?:\s|\\n|\\r|\\t|</?tr\b[^>]*>)*'
 masked=re.sub(MARK+r'(?:'+gap+MARK+r')+',MARK,masked,flags=re.I)
 return masked,{'complete_cells':len(cells),'empty_cells':sum(flags),'last600_all_empty':len(flags)>=600 and all(flags[-600:]),'collapsed_markers':masked.count(MARK),'pipeline_images_stripped':n_img}
class Guard:
 def __init__(self,imagini=frozenset()):self.imagini=frozenset(imagini);self.semantic=PriorGuard();self.reset()
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
