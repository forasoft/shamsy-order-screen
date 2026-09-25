# Notes for the real build

## What we would do differently

1. **Supabase Auth and row-level security instead of our own session.** Here the server signs the user in and names the acting user to the database in every transaction; the triggers do the rest. In the platform, the acting user comes from Supabase Auth (`auth.uid()`) and row-level security decides who reads what, with cost prices in their own tables. The triggers carry over unchanged, so the rules hold even for a direct call to Supabase's own API.
2. **Approval as a proper workflow.** In the trial the adviser sends the order to the owner and the owner ticks the line. For real: a notification to the owner, approve or reject with a comment, requests that expire, and the adviser told the outcome on her phone.
3. **Offline in IndexedDB, with the proof photos.** The trial keeps the draft and the queue in the browser's local storage. Receipts with photos need IndexedDB and background sync. The pattern stays the same: an id made on the phone, saved once, and every rule checked again on arrival.
4. **Order numbers for offline orders.** The server gives the number when the order arrives. If an adviser needs a number on a receipt before sync, each adviser gets a number range to allocate on the phone.
5. **An audit trail on every table.** Price and settings changes are logged here; the platform logs every change to orders, movements and stock.
6. **CI from the first commit.** A GitHub Actions workflow runs the database, HTTP and phone tests against a real PostgreSQL on every pull request (`.github/workflows/ci.yml`).

## Rules we would like to confirm

1. **Band edges.** We read "up to 3%" as ≤ 3.00% (sand), "between 3% and 5%" as above 3.00% up to 5.00% (red), and "above 5%" as blocked. The comparison is exact, not rounded, so a discount of 5.004% displays as 5.00% but is blocked. Should the bands use the rounded figure instead?
2. **Rate precision.** The rate is stored as whole pounds per dollar. If exchangers ever quote 8,212.5, we would store it in hundredths — worth deciding now, because saved orders never change.
3. **Rules that change while the adviser is offline.** An order written offline at 8,100 is refused on sync if the owner has meanwhile raised the minimum to 8,300; the adviser sees why and fixes it. The same goes for a price change. Is that what you want, or should an order keep the rules that held when it was written?
4. **Stale approval requests.** The owner approves against today's prices and minimum rate; if either moved after the adviser asked, the approval is refused and the adviser must re-enter the order. Confirm.
5. **"Only the owner can change prices".** The trial lets the owner change the catalogue price. Step 2 of the brief also mentions an owner override on a single order; we would add that as a line-level override recorded with the owner's name, like an approval.
