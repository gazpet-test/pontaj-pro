DROP POLICY IF EXISTS ofertare_storage_rw ON storage.objects;
CREATE POLICY ofertare_storage_rw ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'ofertare') WITH CHECK (bucket_id = 'ofertare');
