import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVENT_CG_V2_IDS, getSceneCg } from './story-cgs';
import { getStoryVideo, sceneCgVideoId } from './story-video';

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const images = JSON.parse(readFileSync('scripts/art/library/recipes/event-cg-v2-20260905.images.json', 'utf8')) as {
  images: { id: string; target: string; sha256: string; provenance: string; provenance_sha256: string; parent_job: string; input_sha256: string }[];
};

describe('event CG v2 delivery integrity', () => {
  it('all displayed CGs match reviewed image bytes and immutable generation provenance', () => {
    expect(images.images.map(image => image.id).sort()).toEqual([...EVENT_CG_V2_IDS].sort());
    for (const image of images.images) {
      expect(getSceneCg(image.id)?.src).toBe('/' + image.target.replace(/^public\//, ''));
      expect(digest(image.target)).toBe(image.sha256);
      expect(digest(image.provenance)).toBe(image.provenance_sha256);
      const provenance = JSON.parse(readFileSync(image.provenance, 'utf8'));
      expect(provenance.provider).toBe('gpt-image-2');
      expect(provenance.display.sha256).toBe(image.sha256);
      expect(provenance.video_parent.sha256).toBe(image.input_sha256);
      expect(provenance.references.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('every displayed loop comes from the corresponding approved v2 image and a completed two-format export', () => {
    const delivery = JSON.parse(readFileSync('scripts/art/library/recipes/event-cg-v2-20260905.delivery.json', 'utf8'));
    expect(delivery.pairs).toHaveLength(8);
    for (const image of images.images) {
      const job = delivery.jobs.find((entry: { parent_job: string }) => entry.parent_job === image.parent_job);
      expect(job.inputs.reference.sha256).toBe(image.input_sha256);
      const pair = delivery.pairs.find((entry: { job_id: string }) => entry.job_id === job.id);
      expect(pair.state).toBe('complete');
      expect(delivery.reviews.find((entry: { job_id: string }) => entry.job_id === job.id)).toMatchObject({
        decision: 'approved', output_hash: pair.source_hash,
      });
      const video = getStoryVideo(sceneCgVideoId(image.id))!;
      for (const format of ['mp4', 'webm'] as const) {
        const file = 'public' + video[format];
        const media = pair.definition.parts[format].media;
        expect(digest(file)).toBe(media.sha256);
        expect(statSync(file).size).toBeLessThanOrEqual(2_500_000);
        expect(media).toMatchObject({ frames: 106, width: 768, height: 1152 });
      }
    }
  });
});
