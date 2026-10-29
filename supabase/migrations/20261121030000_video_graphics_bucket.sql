-- =====================================================================
-- SECOND BRAIN · VIDEO SCENE GRAPHICS
-- =====================================================================
-- Make video now draws one illustration per scene (lib/video/graphics.ts)
-- and keeps it in the videos bucket beside the narration, at
-- <space>/<video>/graphics/<scene>.<png|jpg|webp>. The image model returns
-- PNG or WebP, so the bucket accepts those next to JPEG.
-- =====================================================================

update storage.buckets
set allowed_mime_types = array['audio/mpeg', 'text/html', 'application/json', 'video/mp4', 'image/jpeg', 'image/png', 'image/webp']
where id = 'videos';
