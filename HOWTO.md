# How to keep PHILBIZ up to date

## Browser (HTML/JS only)
Double-click index.html. It loads snapshot.js (last good wire). Live fetch in
background updates if network+proxy OK.

## Cron (every 30 minutes) — optional but recommended
Add to crontab:
*/30 * * * * cd /home/paul/Desktop/PhilBiz && node refresh.mjs

## Project layout
.
├── index.html          # page shell
├── styles.css          # drudge look
├── app.js              # client logic
├── refresh.mjs         # write data/snapshot.js
├── data/snapshot.js    # cached wire
└── README.md
