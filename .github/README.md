# Move these two files into place

Claude cannot write into `.github/workflows/` on this computer, so the two workflow files are parked
here. From the repository folder, run:

```bash
mkdir -p .github/workflows && git mv -k install-workflows/*.yml .github/workflows/ 2>/dev/null || mv install-workflows/*.yml .github/workflows/
rm -r install-workflows
```

- `pages.yml` publishes the site to GitHub Pages on every push to `main`.
- `sync.yml` reads DonorPerfect every 5 minutes and redeploys when the numbers change.
