# DSH plugin market index (format 1)

Generated with the official `@deepseek-ai/dsh-plugin-market-generator` from
`plugins.txt` (source: the `dsh-famling` npm package). Add the raw URL as a
custom index source in DSH Discover:

    https://raw.githubusercontent.com/PerryLink/dsh-famling/main/docs/market/index.json

Only public registry metadata is listed; the generator never installs or runs
package code. Regenerate after publishing a new npm version:

    pnpm --filter @deepseek-ai/dsh-plugin-market-generator start \
      --input plugins.txt --output index.json --title "Famling Market"
