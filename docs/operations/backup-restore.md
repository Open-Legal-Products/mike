# Backup and restore exercise

Production remains blocked until the selected database, object storage, auth,
configuration, and audit systems have documented backup scope and a successful
isolated restore exercise.

## Required evidence

1. Inventory every stateful system, encryption key dependency, backup region,
   retention period, access role, and deletion limitation.
2. Create a backup from synthetic staging data containing a known record set and
   file hashes. Confirm encryption and least-privilege access.
3. Restore into a new isolated environment—not over staging or production.
4. Apply migrations in documented order and verify counts, hashes, ownership,
   sharing boundaries, soft-deletion state, download controls, and audit access.
5. Exercise authentication recovery without copying production secrets.
6. Run the complete engineering gate and the staging user journey against the
   restored environment.
7. Record recovery point and recovery time observations. The product owner must
   approve targets before they are described as commitments.
8. Destroy the exercise environment and confirm its backup/secret cleanup.

A database-only restore is insufficient when object storage, auth identities,
keys, or source versions are required to make records usable and correctly
isolated. Backup expiry and deletion propagation remain privacy-review items.
