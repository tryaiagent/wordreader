const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

async function setup() {
  const elements = new Map();
  function element() {
    return {
      value: '', hidden: false, disabled: false, checked: false, textContent: '',
      handlers: {}, children: [], classList: { add() {}, remove() {} },
      addEventListener(name, handler) { this.handlers[name] = handler; },
      appendChild(child) { this.children.push(child); },
      add() {}, focus() {}, scrollIntoView() {},
      removeAttribute(name) { delete this[name]; },
      click() { this.clicks = (this.clicks || 0) + 1; }
    };
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, element());
  elements.get('publishedLinks').hidden = true;
  elements.get('repeatCount').value = '1';
  elements.get('gapSeconds').value = '0';
  elements.get('githubRepo').value = 'test-owner/test-repo';
  elements.get('githubToken').value = 'github-test-token';
  elements.get('pagesUrl').value = 'https://test-owner.github.io/test-repo/';
  const blobs = new Map();
  const revoked = [];
  const spoken = [];
  const context = vm.createContext({
    document: {
      getElementById: id => elements.get(id),
      createElement: element,
      querySelectorAll: () => []
    },
    window: {
      speechSynthesis: {
        getVoices: () => [], cancel() {},
        speak(utterance) { spoken.push(utterance.text); utterance.onend(); }
      }
    },
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    Option: function () {},
    fetch: async () => ({ ok: true, text: async () => 'apple\nbright\nquiet' }),
    URL: class extends URL {
      static createObjectURL(blob) { const url = `blob:${blobs.size}`; blobs.set(url, blob); return url; }
      static revokeObjectURL(url) { revoked.push(url); }
    },
    Blob, AbortController, setTimeout, clearTimeout, console
  });
  vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  const githubRequests = [];
  const github = { status: 200, failAt: 1 };
  let fetchHandler = context.fetch;
  Object.defineProperty(context, 'fetch', {
    get() {
      const handler = fetchHandler;
      return async (url, options) => {
        if (!url.startsWith('https://api.github.com/')) return handler(url, options);
        githubRequests.push({ url, ...options });
        assert.equal(elements.get('resetBtn').disabled, true);
        assert.equal(elements.get('githubRepo').disabled, true);
        assert.equal(elements.get('startBtn').disabled, true);
        assert.equal(options.headers.Authorization, 'Bearer github-test-token');
        const data = url.endsWith('/git/ref/heads/main') ? { object: { sha: 'base-commit' } }
          : url.endsWith('/git/commits/base-commit') ? { tree: { sha: 'base-tree' } }
            : { sha: url.endsWith('/git/trees') ? 'new-tree' : 'new-commit' };
        const status = githubRequests.length === github.failAt ? github.status : 200;
        return { ok: status === 200, status, json: async () => data };
      };
    },
    set(handler) { fetchHandler = handler; }
  });
  return {
    elements, blobs, revoked, spoken, context, githubRequests, github,
    run: code => vm.runInContext(code, context),
    click: id => elements.get(id).handlers.click(),
    reply(transform = items => items) {
      context.fetch = async (url, options) => {
        assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
        assert.equal(options.headers.Authorization, 'Bearer personal-key');
        const body = JSON.parse(options.body);
        assert.equal(body.response_format.json_schema.strict, true);
        const words = JSON.parse(body.messages[1].content).words;
        const items = transform(words.map(word => ({ word, sentence: `We wrote the word ${word} on the board.` })));
        return { ok: true, json: async () => ({ choices: [{
          finish_reason: 'stop', message: { content: JSON.stringify({ items }) }
        }] }) };
      };
      elements.get('apiKey').value = 'personal-key';
    }
  };
}

test('reading stays locked after loading, setting a count and direct navigation', async () => {
  const app = await setup();
  assert.equal(app.elements.get('startBtn').disabled, true);
  assert.equal(app.elements.get('nextBtn').disabled, true);
  app.elements.get('wordCount').value = '2';
  app.click('setCountBtn');
  app.run('goTo(0)');
  assert.equal(app.run('index'), -1);
  assert.equal(app.spoken.length, 0);
  await app.click('generateBtn');
  assert.match(app.elements.get('generationStatus').textContent, /API key first/);
  assert.equal(app.elements.get('startBtn').disabled, true);
});

test('words-1 loads its hosted file and enables generation for that list', async () => {
  const app = await setup();
  const fileText = readFileSync(resolve(__dirname, '../words-files/words-1.txt'), 'utf8');
  const requestedFiles = [];
  app.context.fetch = async name => {
    requestedFiles.push(name);
    return { ok: true, text: async () => fileText };
  };
  const pending = app.elements.get('listButtons').children[0].handlers.click();
  assert.equal(app.elements.get('generateBtn').disabled, true);
  await pending;
  assert.deepEqual(requestedFiles, ['words-files/words-1.txt']);
  assert.deepEqual(Array.from(app.run('allWords')), ['Muscle', 'weekend']);
  assert.equal(app.elements.get('generateBtn').disabled, false);
  assert.equal(app.elements.get('startBtn').disabled, true);
  app.reply();
  const reply = app.context.fetch;
  app.context.fetch = async (url, options) => {
    const selected = JSON.parse(JSON.parse(options.body).messages[1].content).words;
    assert.deepEqual([...selected].sort(), ['Muscle', 'weekend']);
    return reply(url, options);
  };
  await app.click('generateBtn');
  assert.equal(app.blobs.size, 2);
  assert.equal(app.elements.get('startBtn').disabled, false);
});

test('generation exports exactly one numbered blank sentence per selected word in reading order', async () => {
  const app = await setup();
  app.elements.get('wordCount').value = '2';
  app.click('setCountBtn');
  const order = Array.from(app.run('words.slice(0, total())'));
  app.reply();
  await app.click('generateBtn');
  assert.equal(app.elements.get('startBtn').disabled, false);
  const link = app.elements.get('downloadLink');
  const text = await app.blobs.get(link.href).text();
  assert.equal((text.match(/<li>We wrote the word __________ on the board\.<\/li>/g) || []).length, 2);
  assert.match(text, /<!DOCTYPE html>/);
  assert.match(link.download, /^SPAG_\d{8}_\d{6}_Questions\.html$/);
  assert.equal(link.hidden, false);
  assert.equal(link.clicks, 1);
  assert.equal(text.includes('personal-key'), false);
  const answersLink = app.elements.get('answersDownloadLink');
  const answersText = await app.blobs.get(answersLink.href).text();
  assert.ok(answersText.includes(order.map(word => `<li>We wrote the word <strong><u>${word}</u></strong> on the board.</li>`).join('\n')));
  assert.equal(answersLink.download, link.download.replace('_Questions.html', '_Answers.html'));
  assert.equal(answersLink.hidden, false);
  assert.equal(answersLink.clicks, 1);
  assert.equal(answersText.includes('personal-key'), false);
  app.click('startBtn');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.spoken[0], order[0]);
  app.click('resetBtn');
  assert.equal(app.elements.get('startBtn').disabled, true);
  assert.equal(link.hidden, true);
  assert.equal(answersLink.hidden, true);
  assert.equal(answersLink.href, undefined);
  assert.equal(app.revoked.length, 2);
});

test('invalid responses and API failures never unlock reading or produce partial files', async t => {
  const cases = [
    ['missing items', items => items.slice(1)],
    ['wrong order', items => items.reverse()],
    ['missing target', items => items.map(item => ({ ...item, sentence: 'This has no target.' }))],
    ['repeated target', items => items.map(item => ({ ...item, sentence: `${item.word} and ${item.word}.` }))],
    ['multiline', items => items.map(item => ({ ...item, sentence: `${item.word}\nis here.` }))],
    ['unfinished sentence', items => items.map(item => ({ ...item, sentence: `${item.word} is here` }))]
  ];
  for (const [name, transform] of cases) {
    await t.test(name, async () => {
      const app = await setup();
      app.reply(transform);
      await app.click('generateBtn');
      assert.equal(app.elements.get('startBtn').disabled, true);
      assert.equal(app.blobs.size, 0);
      assert.match(app.elements.get('status').textContent, /Generation failed/);
    });
  }
  for (const status of [401, 403, 429, 500]) {
    await t.test(`HTTP ${status}`, async () => {
      const app = await setup();
      app.reply();
      app.context.fetch = async () => ({ ok: false, status });
      await app.click('generateBtn');
      assert.equal(app.elements.get('startBtn').disabled, true);
      assert.equal(app.blobs.size, 0);
      assert.match(app.elements.get('status').textContent, /Generation failed/);
    });
  }
});

test('multiple API batches become one complete file, with no early unlocking', async () => {
  const app = await setup();
  app.run(`loadWords('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform')`);
  app.reply();
  const reply = app.context.fetch;
  let requests = 0;
  app.context.fetch = async (...args) => {
    requests++;
    assert.equal(app.elements.get('startBtn').disabled, true);
    assert.equal(app.blobs.size, 0);
    return reply(...args);
  };
  await app.click('generateBtn');
  assert.equal(requests, 2);
  assert.equal(app.blobs.size, 2);
  const text = await app.blobs.get(app.elements.get('downloadLink').href).text();
  assert.equal((text.match(/<li>/g) || []).length, 21);
  const answers = await app.blobs.get(app.elements.get('answersDownloadLink').href).text();
  assert.equal((answers.match(/<li>/g) || []).length, 21);
  assert.equal(answers.includes('__________'), false);
  assert.equal(app.elements.get('startBtn').disabled, false);
});

test('changing the selection cancels stale generation and prevents stale downloads', async () => {
  const app = await setup();
  app.reply();
  const reply = app.context.fetch;
  let finish;
  app.context.fetch = (...args) => new Promise(resolve => { finish = () => resolve(reply(...args)); });
  const pending = app.click('generateBtn');
  app.elements.get('wordCount').value = '1';
  app.click('setCountBtn');
  finish();
  await pending;
  assert.equal(app.blobs.size, 0);
  assert.equal(app.elements.get('startBtn').disabled, true);
  assert.equal(app.elements.get('generateBtn').disabled, false);
});

test('blanking handles case, apostrophes and hyphenated words without partial-word matches', async () => {
  const app = await setup();
  assert.equal(app.run(`blankSentence({ word: 'apple', sentence: 'An APPLE fell.' }, 'apple')`), 'An __________ fell.');
  assert.equal(app.run(`blankSentence({ word: "don't", sentence: "Please don't run." }, "don't")`), 'Please __________ run.');
  assert.equal(app.run(`blankSentence({ word: 'well-known', sentence: 'She is a well-known artist.' }, 'well-known')`), 'She is a __________ artist.');
  assert.throws(() => app.run(`blankSentence({ word: 'apple', sentence: 'An pineapple fell.' }, 'apple')`));
});

test('HTML answer formatting preserves the exact matched word, case and surrounding sentence', async () => {
  const app = await setup();
  app.reply(() => [
    { word: 'apple', sentence: 'An APPLE fell beside the pineapple.' },
    { word: "don't", sentence: "Please don't run." },
    { word: 'well-known', sentence: 'She is a well-known artist.' }
  ]);
  app.run(`words = ['apple', "don't", 'well-known']`);
  await app.click('generateBtn');
  const text = await app.blobs.get(app.elements.get('answersDownloadLink').href).text();
  assert.ok(text.includes('<li>An <strong><u>APPLE</u></strong> fell beside the pineapple.</li>'));
  assert.ok(text.includes('<li>Please <strong><u>don&#39;t</u></strong> run.</li>'));
  assert.ok(text.includes('<li>She is a <strong><u>well-known</u></strong> artist.</li>'));
});

test('filenames use local DDMMYYYY_HHMMSS with zero padding', async () => {
  const app = await setup();
  assert.equal(app.run('worksheetFilenamePrefix(new Date(2026, 9, 21, 13, 26, 1))'), 'SPAG_21102026_132601');
  assert.equal(app.run('worksheetFilenamePrefix(new Date(2026, 0, 2, 3, 4, 5))'), 'SPAG_02012026_030405');
});

test('publishing commits both HTML pages atomically and provides matching Pages links', async () => {
  const app = await setup();
  app.reply();
  await app.click('generateBtn');
  assert.equal(app.githubRequests.length, 5);
  const [ref, base, tree, commit, update] = app.githubRequests;
  assert.ok(ref.url.endsWith('/git/ref/heads/main'));
  assert.ok(base.url.endsWith('/git/commits/base-commit'));
  const treeBody = JSON.parse(tree.body);
  assert.equal(treeBody.base_tree, 'base-tree');
  assert.equal(treeBody.tree.length, 2);
  for (const entry of treeBody.tree) {
    assert.match(entry.path, /^generated\/SPAG_\d{8}_\d{6}_(Questions|Answers)\.html$/);
    assert.match(entry.content, /<!DOCTYPE html>/);
    assert.equal(entry.content.includes('personal-key'), false);
    assert.equal(entry.content.includes('github-test-token'), false);
  }
  assert.deepEqual(JSON.parse(commit.body).parents, ['base-commit']);
  assert.equal(JSON.parse(commit.body).tree, 'new-tree');
  assert.equal(update.method, 'PATCH');
  assert.deepEqual(JSON.parse(update.body), { sha: 'new-commit', force: false });
  assert.equal(app.elements.get('publishedLinks').hidden, false);
  assert.equal(app.elements.get('questionsPageLink').href,
    `https://test-owner.github.io/test-repo/generated/${app.elements.get('downloadLink').download}`);
  assert.equal(app.elements.get('answersPageLink').href,
    `https://test-owner.github.io/test-repo/generated/${app.elements.get('answersDownloadLink').download}`);
});

test('publishing failures keep downloads available, reading locked and settings editable', async t => {
  for (const status of [401, 403, 404, 409, 422, 500]) {
    await t.test(`GitHub HTTP ${status}`, async () => {
      const app = await setup();
      app.reply();
      app.github.status = status;
      await app.click('generateBtn');
      assert.equal(app.blobs.size, 2);
      assert.equal(app.elements.get('startBtn').disabled, true);
      assert.equal(app.elements.get('githubRepo').disabled, false);
      assert.equal(app.elements.get('publishedLinks').hidden, true);
      assert.match(app.elements.get('generationStatus').textContent, /GitHub/);
      assert.equal(app.githubRequests.length, 1);
    });
  }
});

test('invalid publishing settings stop before making any API request', async t => {
  for (const [id, value] of [
    ['githubRepo', '../wrong/repo'], ['githubToken', ''], ['pagesUrl', 'javascript:alert(1)'],
    ['pagesUrl', 'https://user:password@example.com/'], ['pagesUrl', 'not a URL']
  ]) {
    await t.test(`${id}: ${value}`, async () => {
      const app = await setup();
      app.reply();
      app.elements.get(id).value = value;
      let requests = 0;
      app.context.fetch = async () => { requests++; throw new Error('Unexpected request'); };
      await app.click('generateBtn');
      assert.equal(requests, 0);
      assert.equal(app.githubRequests.length, 0);
      assert.equal(app.blobs.size, 0);
      assert.equal(app.elements.get('startBtn').disabled, true);
    });

  }
});

test('a rejected non-fast-forward branch update never reports publication success', async () => {
  const app = await setup();
  app.reply();
  app.github.status = 422;
  app.github.failAt = 5;
  await app.click('generateBtn');
  assert.equal(app.githubRequests.length, 5);
  assert.equal(JSON.parse(app.githubRequests[4].body).force, false);
  assert.equal(app.elements.get('publishedLinks').hidden, true);
  assert.equal(app.elements.get('startBtn').disabled, true);
  assert.equal(app.elements.get('generateBtn').disabled, false);
  assert.equal(app.blobs.size, 2);
  assert.match(app.elements.get('generationStatus').textContent, /main may have changed/);
});

test('generated HTML escapes model markup instead of executing it', async () => {
  const app = await setup();
  app.reply(items => items.map(item => ({
    ...item, sentence: `The word ${item.word} <img src=x onerror=alert(1)> is on the board.`
  })));
  await app.click('generateBtn');
  for (const blob of app.blobs.values()) {
    const html = await blob.text();
    assert.equal(html.includes('<img'), false);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  }
});

test('a failure in a later batch discards the whole worksheet', async () => {
  const app = await setup();
  app.run(`loadWords('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform')`);
  app.reply();
  const reply = app.context.fetch;
  let requests = 0;
  app.context.fetch = (...args) => ++requests === 2
    ? Promise.resolve({ ok: false, status: 429 })
    : reply(...args);
  await app.click('generateBtn');
  assert.equal(requests, 2);
  assert.equal(app.blobs.size, 0);
  assert.equal(app.elements.get('startBtn').disabled, true);
  assert.match(app.elements.get('generationStatus').textContent, /rate limit/);
});

test('timeout, malformed JSON and incomplete generation allow retry but not reading', async t => {
  const cases = [
    ['timeout', async () => { throw new Error('aborted'); }],
    ['malformed JSON', async () => ({ ok: true, json: async () => ({
      choices: [{ finish_reason: 'stop', message: { content: '{bad json' } }]
    }) })],
    ['incomplete generation', async () => ({ ok: true, json: async () => ({
      choices: [{ finish_reason: 'length', message: { content: '{}' } }]
    }) })]
  ];
  for (const [name, fetch] of cases) {
    await t.test(name, async () => {
      const app = await setup();
      app.reply();
      app.context.fetch = name === 'timeout'
        ? async () => { app.run('generationController.abort()'); return fetch(); }
        : fetch;
      await app.click('generateBtn');
      assert.equal(app.elements.get('startBtn').disabled, true);
      assert.equal(app.elements.get('generateBtn').disabled, false);
      assert.equal(app.blobs.size, 0);
      if (name === 'timeout') assert.match(app.elements.get('generationStatus').textContent, /timed out/);
      app.reply();
      await app.click('generateBtn');
      assert.equal(app.elements.get('startBtn').disabled, false);
    });
  }
});

test('an older word-list request cannot overwrite a newer selection', async () => {
  const app = await setup();
  let finish;
  app.context.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = app.run("loadFromUrl('older.txt')");
  assert.equal(app.elements.get('startBtn').disabled, true);
  app.run("beginWordLoad(); loadingWords = false; loadWords('newer')");
  finish({ ok: true, text: async () => 'older' });
  assert.equal(await pending, false);
  assert.deepEqual(Array.from(app.run('allWords')), ['newer']);
});

