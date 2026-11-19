-- Selfie liveness + face-match checks for KYC tier 2 (ADR-032).
-- The photo is AES-256-GCM encrypted (identity field key); only reviewers can open it,
-- and each view is audited. A hash stops the same photo being reused by another account.
CREATE TABLE selfie_checks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id),
  image_enc         text NOT NULL,
  image_sha256      text NOT NULL,
  provider          text NOT NULL,
  provider_ref      text,
  liveness_passed   boolean NOT NULL,
  liveness_probability numeric(5,2),
  face_detected     boolean NOT NULL,
  multiple_faces    boolean NOT NULL,
  match_confidence  numeric(5,2),
  matched           boolean,
  status            text NOT NULL CHECK (status IN ('passed', 'failed')),
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX selfie_checks_user ON selfie_checks(user_id, created_at DESC);
CREATE INDEX selfie_checks_image ON selfie_checks(image_sha256);
