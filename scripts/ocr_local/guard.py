"""012: immutable raw output, empty-cell-collapsed detection view only."""
import re, html, hashlib
from .guard_base import Guard as PriorGuard
from .guard_legacy import repetition_reason
VERSION='empty-cells-v3-consecutive600'
POLICY={'last_cells_without_nonempty':600,'repeated_block_chars':200,'repeated_block_occurrences':4,'diversity_tokens_gt':3000,'diversity_chars_lt':100}
CELL=re.compile(r'<td\b([^>]*)>(.*?)</td\s*>',re.I|re.S)
MARK='\ue000'
def empty(m):
 # Strict whitespace/entity-only body; nested markup and semantic attributes stay.
 return not re.search(r'\b(?:title|alt|aria-label|data-value)\s*=',m[1],re.I) and not html.unescape(m[2]).strip()
def view(text):
 cells=list(CELL.finditer(text)); flags=[empty(m) for m in cells]
 masked=CELL.sub(lambda m:MARK if empty(m) else m[0],text)
 # Collapse adjacent empty cells across structural row boundaries, including
 # empty rows. Preserve every nonempty cell verbatim, including zero/dash.
 gap=r'(?:\s|\\n|\\r|\\t|</?tr\b[^>]*>)*'
 masked=re.sub(MARK+r'(?:'+gap+MARK+r')+',MARK,masked,flags=re.I)
 return masked,{'complete_cells':len(cells),'empty_cells':sum(flags),'last600_all_empty':len(flags)>=600 and all(flags[-600:]),'collapsed_markers':masked.count(MARK)}
class Guard:
 def __init__(self):self.semantic=PriorGuard();self.reset()
 def reset(self):self.semantic.reset();self.previous='';self.event=None;self.stats={}
 def __call__(self,text):
  filtered,self.stats=view(text)
  reason=None;event=None
  if self.stats['last600_all_empty']:
   reason='celule_goale_fara_continut';event={'reason':reason}
  else:
   if not filtered.startswith(self.previous):self.semantic.reset()
   self.previous=filtered;reason=self.semantic(filtered);event=self.semantic.event
   if not reason:
    old=repetition_reason(filtered)
    if old:reason='bucla_previous_guard';event={'reason':reason,'detail':old}
  if reason:
   self.event={**(event or {}),'reason':reason,'view_stats':self.stats,'view_sha256':hashlib.sha256(filtered.encode()).hexdigest(),'guard_version':VERSION}
  return reason

