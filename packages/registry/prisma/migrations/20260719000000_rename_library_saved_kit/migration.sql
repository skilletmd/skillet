-- The auto "Saved" kit used to be named "Library" (slug "library"). New accounts
-- get "Saved"/"saved" (getOrCreateSavedKit), but legacy accounts still carry the
-- old name. Normalize them so the kit page, permalink, and Updates group all read
-- "Saved". Skip any owner that somehow already has a "saved" slug (unique
-- owner_id+slug) so the rename can't collide.
UPDATE kits AS k
LEFT JOIN kits AS conflict
  ON conflict.owner_id = k.owner_id AND conflict.slug = 'saved' AND conflict.id <> k.id
SET k.name = 'Saved', k.slug = 'saved'
WHERE k.kind = 'saved' AND k.slug = 'library' AND conflict.id IS NULL;
