"""secret_nou.sh, pasul 1: directorul .secrete există, fără symlink / junction pe cale, iar fișierul țintă nu există (nici symlink dangling)."""
import os
import stat
import sys

d, f = sys.argv[1], sys.argv[2]
os.makedirs(d, exist_ok=True)
for p in (r'C:\Users', r'C:\Users\Gazpet-Ai', d):
    st = os.lstat(p)
    if (getattr(st, 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT) or os.path.islink(p):
        print('REFUZ: calea contine un symlink/junction:', p)
        sys.exit(3)
if os.path.normcase(os.path.realpath(d)) != os.path.normcase(d):
    print('REFUZ: directorul .secrete nu e pe calea asteptata')
    sys.exit(3)
if os.path.lexists(f):
    print('REFUZ: fisierul local exista deja -', f, '- nu suprascriu')
    sys.exit(3)
