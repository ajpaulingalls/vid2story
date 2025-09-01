// Shared browser-side helpers for Vid2Story

function computeProgress(job) {
  if (job && job.progress) return job.progress;
  const videos = Array.isArray(job.videos) ? job.videos : [];
  const totalFromSegments = job && job.segments && job.segments.segments ? job.segments.segments.length : 0;
  const total = job && job.pickSegments ? (totalFromSegments || videos.length) : 1;
  const clipped = videos.filter(v => !!v.clippedVideoUrl).length;
  const cropped = videos.filter(v => !!v.croppedVideoUrl).length;
  const captioned = videos.filter(v => !!v.captionVideoUrl).length;
  const finalized = videos.filter(v => !!v.finalVideoUrl).length;
  return { total, clipped, cropped, captioned, finalized };
}

function formatStatus(job) {
  const { total, clipped, cropped, captioned, finalized } = computeProgress(job);
  const s = job.status;
  if (!job.pickSegments) return s;
  if (!total || total === 0) return s;
  if (s === 'clipping-segments') return `Clipping Segments ${clipped}/${total}`;
  if (s === 'cropping-segments') return `Cropping Segments ${cropped}/${total}`;
  if (s === 'adding-captions') return `Adding Captions ${captioned}/${total}`;
  if (s === 'completed') return `Completed ${finalized}/${total}`;
  return s;
}

function segmentStatus(video) {
  if (video && video.status) return video.status;
  if (video && video.finalVideoUrl) return 'finalized';
  if (video && video.captionVideoUrl) return 'captioned';
  if (video && video.croppedVideoUrl) return 'cropped';
  if (video && video.clippedVideoUrl) return 'clipped';
  return 'pending';
}

function toggleSection(sectionName) {
  const content = document.getElementById(`${sectionName}-content`);
  const toggle = document.getElementById(`${sectionName}-toggle`);
  if (!content || !toggle) return;
  if (content.classList.contains('expanded')) {
    content.classList.remove('expanded');
    toggle.textContent = '▶';
  } else {
    content.classList.add('expanded');
    toggle.textContent = '▼';
  }
}
