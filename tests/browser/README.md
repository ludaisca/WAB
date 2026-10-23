# Operator workspace browser checks

These scripts use a temporary Playwright Docker container. They do not add a
browser or dependencies to the app or the host. Run the app with Docker first.
Use the machine hostname (or its Tailscale DNS name) for `WAB_TEST_ORIGIN`.

Provide `WAB_TEST_SESSIONS`, a private JSON file containing an `admin` session
cookie obtained from a local test login (`{"admin":"<authjs.session-token>"}`).
Never commit that file. Use a test account; the scripts intercept every WhatsApp
API request and never send a message, upload to Meta, or modify real leads.

Example runtime setup, using a task-specific temporary directory:

```bash
mkdir -p /tmp/wab-browser-check
# Place the private sessions.json in that directory.
cp tests/browser/*.mjs /tmp/wab-browser-check/
sudo docker run -d --rm --name wab-ui-browser --network wab_default \
  --add-host "$(hostname):host-gateway" \
  -v /tmp/wab-browser-check:/review \
  mcr.microsoft.com/playwright:v1.56.1-noble sleep infinity
sudo docker exec -w /review wab-ui-browser npm install --no-audit --no-fund playwright@1.56.1
sudo docker exec -w /review -e WAB_TEST_ORIGIN="http://$(hostname):17100" wab-ui-browser node operator-workspace.mjs
sudo docker exec -w /review -e WAB_TEST_ORIGIN="http://$(hostname):17100" wab-ui-browser node lead-pagination.mjs
sudo docker stop wab-ui-browser
rm /tmp/wab-browser-check/sessions.json
```

`operator-workspace.mjs` covers per-chat text/files, route remounts, delayed sends,
late fetches, 150 loaded conversations, multiline input, draft recovery, failed
sends and maintenance errors. `lead-pagination.mjs` covers selection across pages,
a complete 5,101-row CSV export, server filters, catalogs and mobile overflow.
Screenshots use synthetic data and are written into `/review`.
