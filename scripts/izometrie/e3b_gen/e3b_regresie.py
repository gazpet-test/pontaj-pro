"""Adaptari explicite ale suitelor LIVE, fara a modifica sursele lor."""
from pathlib import Path

def generate(root):
    def change(text, old, new):
        assert text.count(old) == 1, old
        return text.replace(old, new, 1)
    e2 = (root / 'supabase/tests/izometrie_e2a.test.sql').read_text(encoding='utf8')
    # 2c: operatiile pe randuri nelegate trec la stoc; rollback pastreaza fixture-ul suitei.
    for label, sql in [
        ('T7a', "DELETE FROM public.executie_tevi WHERE pachet_id = 2"),
        ('T7f', "UPDATE public.executie_tevi SET pachet_id = 1 WHERE serie_unica = 'Y1'"),
        ('T7g', "UPDATE public.executie_tevi SET pachet_id = 2 WHERE serie_unica = 'X1'"),
        ('T7e', "DELETE FROM public.executie_pachete_lansare WHERE id = 2")]:
        lines = [l for l in e2.splitlines() if l.startswith("SELECT teste.eroare('" + label + " ")]
        assert len(lines) == 1, label
        e2 = change(e2, lines[0], "BEGIN;\nSELECT teste.e('" + label + " sub 2c: rand nelegat permis la stoc', teste.n($$" + sql + "$$) = 1);\nROLLBACK;")
    # 2c / E3 / E3b isi pastreaza fiecare valoarea de revenire dupa amprenta (inainte_<migrare>=...), deci COMMENT-ul nu se
    # mai termina in amprenta: se verifica amprenta curenta (prima din text), nu pozitia ei la final
    e2 = change(e2, "~ 'amprenta=[0-9a-f]{32}$');", "~ 'amprenta=[0-9a-f]{32}( |$)');")
    # Q1=A: refuzul E4 ramane; mesajul noii implementari este ASCII.
    e2 = change(e2, "'mi\u0219c\u0103ri ulterioare');", "'miscari ulterioare');")
    e3 = (root / 'supabase/tests/izometrie_e3.test.sql').read_text(encoding='utf8')
    # Q14=A: semnatura noua, omul declarat obligatoriu la anularea confirmatului.
    e3 = change(e3, "fn_izo_doc_anuleaza(bigint, text)", "fn_izo_doc_anuleaza(bigint, text, uuid)")
    e3 = change(e3, "fn_izo_doc_anuleaza(:doc1, 'aviz gre\u0219it, reintrodus')", "fn_izo_doc_anuleaza(:doc1, 'aviz gre\u0219it, reintrodus', '00000000-0000-0000-0000-000000000121')")
    # Celelalte apeluri cu 2 argumente rezolva DEFAULT NULL si pastreaza refuzul API / izolarii.
    out = "-- GENERAT de e3b_regresie.py; suitele LIVE nu se editeaza.\n-- Selectati cu -v e2a=true|false; cate o baza proaspata pentru fiecare ramura.\n\\if :e2a\n" + e2 + "\n\\else\n" + e3 + "\n\\endif\n"
    (root / 'supabase/tests/izometrie_e3b_regresie.sql').write_text(out, encoding='utf8', newline='\n')
