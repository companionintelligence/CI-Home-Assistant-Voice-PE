// public/compose.yml is what people download from ha.ci.computer. It must stay
// in step with the repo's docker-compose.yml, which the tests and CI exercise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const load = async (path) => parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const release = await load('../public/compose.yml');
const repo = await load('../../docker-compose.yml');

for (const service of ['ci-server', 'voice-bridge']) {
  test(`${service}: same environment as the repo compose file`, () => {
    const repoEnv = Object.keys(repo.services[service].environment)
      // The release stack has no Postgres or Redis; ci-server does not need them for voice.
      .filter((k) => !['DATABASE_URL', 'REDIS_URL'].includes(k))
      .sort();
    assert.deepEqual(Object.keys(release.services[service].environment).sort(), repoEnv);
  });

  test(`${service}: same published ports`, () => {
    assert.deepEqual(release.services[service].ports, repo.services[service].ports);
  });

  test(`${service}: uses a published image`, () => {
    assert.match(release.services[service].image, /^ghcr\.io\/companionintelligence\/ci-ha-voice-(server|bridge):/);
    assert.equal(release.services[service].build, undefined);
  });
}

test('speaches profile matches', () => {
  assert.deepEqual(release.services.speaches.profiles, repo.services.speaches.profiles);
  assert.equal(release.services.speaches.image, repo.services.speaches.image);
});
