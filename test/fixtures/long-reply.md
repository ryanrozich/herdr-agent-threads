The garden shop import is done for the spring catalogue. Prices are in, stock counts are in, **most photos too**, and the order form now reads the new sizes without a reload.

The month so far, by supplier. All figures are for 1–9 March:

| Supplier | Cost so far |
|---|---:|
| Seed and bulb wholesale, north depot | $41.250 |
| Pots and planters, south yard | $6.180 |
| Map look-ups for delivery | $3.762 |
| Photo storage and resizing | $1.044 |
| **Total** | **$52.236** |
| **Credit left on the delivery account** | **$0** |

The $41.250 total includes **4,180 map look-ups at $0.009 each**. Most were repeats for the same postcodes; caching them would cut the bill by about two thirds.

Photo resizing ran twice for the same images on 3–4 March; that was a retry loop, now fixed. The delivery account has run dry at **$0 left, with 210 orders waiting for a route**.

Recommendation: **$25 credit to finish the delivery routes, then cache repeated postcode look-ups**. Current balance −$0.21 after the last refund, so the next route request will fail until the credit lands. The cache change is small and can ship the same day.

Second, the north depot's catalogue file still lists 38 discontinued bulbs, which shows up as stock that cannot be ordered. Removing them is a one-line filter in the import.

These are the open choices:

1. **Delivery credit:** add $25 to the route account before Friday. I recommend yes; without it the 210 waiting orders stay unrouted.

2. **Bulb list, ord-20431:** a dozen bulbs are listed under two names and two prices; I would keep the cheaper listing and send the other to the depot to fix. A reply from them could take a week, so I would hide the duplicates now.

3. **Planter sizes:** the south yard’s file mixes centimetres and inches, sometimes in one row, with no flag to say which. I can guess from the range, but a wrong guess shows a planter ten times too big.

4. **Photo backlog:** 64 of 71 photos are in, the rest are late from the supplier. The import shows a grey tile in their place; I can hide those products until the photos come instead.

5. **Delivery notes field:** “Leave by gate” notes come through with line breaks that the route printer turns into blank pages; I can flatten them to one line on import, or leave them and fix the printer settings.

6. **Tax display:** the shop shows prices with tax on the product page and without on the basket page. I can align both on with tax; the basket total does not change.

7. **Discount codes:** last year’s codes still work in `/checkout`, they give 15% off anything, so any older flyer still in circulation costs money. **I would switch them off tonight.** Two customers used one this week.

8. **Weekend hours, on page 2:** the opening times page says Sunday closed, which was true last year. The new summer hours start next week and nobody has sent them yet.

9. **Stock alert emails:** they go to an inbox nobody reads, and 40 alerts sat there in March. A shared inbox or a daily summary to the shop team would get them seen, and I can set either up in an hour if you pick one.

10. **Seed packet sizes, ord-20477:** the new 50 g packet is listed at $12.40 against $11.90 for the 100 g one. **Price check needed.** It is probably a typo on the depot side.

That is the whole list for this week. Two need a yes or no from you: the credit and the discount codes, and the rest can wait for Monday.

I left the import running on the north depot file overnight, with the duplicate-bulb filter on, so tomorrow's catalogue should already be clean. The south yard file waits for the size question.

For the record, the checks I ran before writing this: the import log for both depots, the order queue, the delivery account's last thirty days, and the photo folder. Nothing else changed in the shop settings since Monday, and the payment page still passes its checks in both browsers we test.

One more thing to watch: the spring sale banner is set to start on the 20th, but the sale prices in the catalogue start on the 21st. Customers who click the banner on the first day will see full prices. I can move the banner a day, or start the prices a day early; either is a two-minute change once you say which.

If you want the delivery routes sooner than Friday, the credit can go in tonight and the first batch of routes would print by eight tomorrow morning, which still makes the morning van.
