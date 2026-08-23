# Renewal invoicing — billing rules

> Inherited with the code. Last edited three years and four maintainers ago,
> and reproduced here unchanged, wrong sentences included. It is the artefact a
> specification-shaped test suite would be written from, which is why it is in
> the repository rather than summarised: `divergences.ts` records the five
> places it disagrees with `legacy/renewal.ts`, and proves each one by running
> the code.

## Plans

A subscription is billed monthly, per seat.

| Plan | Price per seat |
|------|----------------|
| Basic | 9 |
| Pro | 29 |
| Enterprise | 99 |

An unrecognised plan is billed at the basic rate and reported in the service
log.

Accounts created before 1 January 2019 keep their original price: basic 7, pro
19. Enterprise did not exist before the repricing.

## Discounts

Volume:

| Seats | Discount |
|-------|----------|
| 100 or more | 15% |
| 25 or more | 7% |

Loyalty: 1% for each complete year the account has been open, to a maximum of
five years.

Volume and loyalty discounts are added together and applied once. An account
with 500 seats and five years of loyalty is billed at 80% of list.

## Coupons

| Code | Effect |
|------|--------|
| `SAVE10` | 10% off |
| `WELCOME` | 20 off |

The coupon is applied to the discounted amount, and any account credit is
deducted from the result. An unrecognised code is reported in the service log
and the invoice is charged in full.

## Proration

An account renewed part-way through a billing period is charged for the days
elapsed, out of thirty. An account renewed after a full period is charged in
full.

## Credit and totals

Account credit is held in minor units and deducted from the amount due. An
invoice total is never negative; unused credit is carried forward to the next
period.

## Tax

Tax is charged on the payable amount at the rate registered for the invoice
currency (USD 7.25%, EUR 20%, JPY 10%). A currency with no registered rate is
billed untaxed and reported in the service log.

## Audit

A small, randomly chosen fraction of invoices — about one in twenty — is
flagged for manual audit.
