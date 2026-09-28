-- Audit Ofertare R12 (28.09.2026): bucket-ul „ofertare" avea politică ALL doar pe bucket_id —
-- orice utilizator autentificat (inclusiv fără modulul Ofertare) putea citi/scrie/șterge
-- documentația licitațiilor. Acum: owner sau intrare explicită 'ofertare' în user_module_access
-- (fn_are_acces_ofertare, aceeași regulă ca RPC-urile modulului). Edge functions / workerul
-- rulează cu service_role și nu sunt afectate. Verificat înainte: 0 fișiere urcate în ultimele
-- 30 de zile de utilizatori fără acces la modul.
DROP POLICY IF EXISTS ofertare_storage_rw ON storage.objects;
CREATE POLICY ofertare_storage_rw ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'ofertare' AND public.fn_are_acces_ofertare())
  WITH CHECK (bucket_id = 'ofertare' AND public.fn_are_acces_ofertare());
