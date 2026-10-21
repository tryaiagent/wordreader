# Word Reader

A static spelling reader and AI sentence worksheet generator. No build step or
backend is required.

## Use

1. Open the site in Safari or Chrome, including on an iPad or mobile phone.
2. Choose a words file (one word per line), or use a hosted word list.
3. Optionally enter a word count and press **Set**. This shuffles the selection
   and enables auto-advance, but does not start speech.
4. Create your own API key at <https://console.groq.com/keys> and paste it into
   the Groq API key field.
5. Fill in **GitHub publishing configuration** at the bottom of the page:
   repository as `owner/name`, a fine-grained GitHub token, and the actual site
   base URL, such as `https://owner.github.io/EnglishSPAG/` (not an HTML file URL).
   The token must be limited to that repository with **Contents: Read and write**.
   The existing `main` branch must allow direct pushes by your account/token.
6. Press **Generate**. The app sends the selected words to Groq using
   `openai/gpt-oss-20b`, in batches of up to 20 words.
7. After every sentence passes structural validation, the app creates a
   `SPAG_DDMMYYYY_HHMMSS_Questions.html` page: numbered sentences, exactly one blank per word,
   and spacing between sentences. A second page, `SPAG_DDMMYYYY_HHMMSS_Answers.html`, contains
   the same sentences with the blanks filled in, in matching numbered order.
   Each answer is rendered bold and underlined using `<strong><u>word</u></strong>`.
   Model text is HTML-escaped, so it cannot inject markup into either page.
   Both filenames share the generation-completion timestamp in the device's local
   time, for example `SPAG_21102026_132601_Questions.html` and
   `SPAG_21102026_132601_Answers.html`.
   Both files use the same response, with no additional Groq requests.
8. Generate commits both pages together under `generated/` on `main` using the
   GitHub Git Data API. It preserves the existing tree and uses a non-forced branch
   update to avoid overwriting concurrent commits. Selection and publishing inputs
   are disabled while publishing. After the push, the app displays two disabled
   GitHub Pages link labels and checks the actual public URLs. A successful commit
   does not mean Pages deployment has finished.
   The app checks both URLs every 5 seconds for up to 5 minutes, using
   cache-bypassing, credential-free requests with a 10-second request timeout.
   Both responses must succeed and contain the expected generated HTML, not a
   fallback page. Only then do both links and **Start** become enabled.
   Clicking **Generate** immediately disables any previous publication links.
   Reset or changing the selected words cancels outstanding deployment checks
   so old responses cannot reactivate links.
   If verification times out or fails, both links and Start remain disabled.
   Use **Retry availability check** to check the same committed pages again,
   without another Groq request, filename change or GitHub push.
9. Optional local copies are available via **Download questions (.html)** and
   **Download answers (.html)**. On
   iOS/iPadOS, use the browser's Share / Save to Files option if necessary.
10. Press **Start** after generation, publishing and both Pages availability checks succeed. Words are spoken in worksheet order; repeat, gap, voice,
   pause, replay, previous and next controls remain available.

Changing the list, applying a word count or pressing Reset reshuffles the words
and invalidates the worksheet. Generate again before reading. Failed, incomplete
or timed-out generation never enables reading or exports a partial worksheet.
If publishing fails, reading remains locked, but the completed HTML downloads
remain available. Check the repository before retrying after a network error or
timeout during publishing: the commit may have succeeded despite a lost response.
**Generate** runs generation again; **Retry availability check** only checks Pages.
Published files are not removed by Reset. Reset, a new selection or Generate clears
the current publication links and retry state. Links last for this tab session;
committed pages remain available at their URLs after reload.
Large selections may hit Groq's account-specific rate limits; select fewer words
or wait before retrying. There are no automatic paid retries.

The app checks response counts, order, target-word occurrences and basic sentence
format, but cannot guarantee the model's grammar or educational suitability.
Review worksheets before use. Free-tier access, pricing and model availability
are controlled by Groq.

## Privacy and hosting

Both tokens are held only in the current page's password fields and request memory.
They are not stored in browser storage, placed in URLs or written to generated pages.
Reloading clears them and the publishing configuration. The Groq key and selected
words go only to Groq; the GitHub token and HTML pages go only to `api.github.com`.
Only use your own tokens on a trusted device; browser extensions and any scripts
running on the page can access them. Never commit real tokens. Published questions
and answers are accessible to anyone who can access the Pages site.

To publish with GitHub Pages, upload [index.html](./index.html) to a repository
and enable **Settings > Pages > Deploy from a branch**, choosing **main** and
**/ (root)**. This is necessary to publish the generated folder alongside the app.
Optional custom Actions deployments must also include `generated/`.
For availability verification, open the app on the same Pages site as the configured
base URL when possible. A different origin must allow cross-origin requests (CORS).
If CORS or network restrictions prevent reading the Pages responses, the app
explicitly reports that verification could not be completed and leaves links and
Start disabled, even if the pages can be opened manually. It does not treat opaque
`no-cors` responses as proof of deployment. Correct the URL/hosting or connection
and use **Retry availability check**.
Optionally add `words.txt` at the root and
`words-files/words-1.txt` through `words-files/words-10.txt`. These word files are
optional except for the included `words-files/words-1.txt` test list; without a
hosted list, choose a local file using the file picker.

GitHub Pages cannot keep a shared API secret. This personal-key design requires
each device/user to supply a key. A public app with a shared key needs a separate
authenticated, rate-limited backend instead.

## Validation

With Node.js installed, run:

```sh
node --test tests/worksheet.test.cjs
```

The tests mock Groq and speech; they do not send words or keys to external
services. A live generation and publication require your own Groq key, GitHub
token, configured repository and Pages URL, and internet access.

