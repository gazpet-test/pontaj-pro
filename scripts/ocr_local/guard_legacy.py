import re, collections
def repetition_reason(text):
    if re.search(r'([a-zăâîșțşţ])\1{31,}', text, re.I):
        return 'Repeated letter run (32 characters)'
    lines = [re.sub(r'\s+', ' ', s.strip().lower()) for s in text.splitlines() if len(s.strip()) > 45]
    if any(count >= 4 for count in collections.Counter(lines).values()):
        return 'Repeated long line (4 times)'
    if re.search(r'(?:\[ILIZIBIL\]\s*[,;. ]*\s*){16,}', text, re.I):
        return 'Repeated unreadable markers (16 times)'
    if re.search(r'(?:alin\.\s*\d+\s*[,; ]+){16,}', text, re.I):
        return 'Suspicious consecutive paragraph enumeration (16 items)'
    return None
