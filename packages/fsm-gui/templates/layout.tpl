<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{# title}</title>
<style>
body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: #1d1d1f; background: #fff; }
header { padding: 12px 20px; border-bottom: 1px solid #d0d0d7; }
header a { color: inherit; font-weight: 600; text-decoration: none; }
main { padding: 20px; max-width: 960px; margin: 0 auto; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 20px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e5ea; }
pre { overflow-x: auto; background: #f5f5f7; padding: 12px; }
.errors { border: 1px solid #c00; color: #900; padding: 8px 14px; margin-bottom: 20px; }
.errors code { font-size: 13px; }
.notice { color: #555; }
</style>
<link rel="stylesheet" href="/assets/crudui.css">
<link rel="icon" href="/favicon.ico">
<script type="module" src="{= assets.hyper}"></script>
</head>
<body hx-boost:inherited="true" hx-target:inherited="#content" hx-swap:inherited="innerMorph">
<header><a href="/">fsm</a></header>
<main id="content">{# content}</main>
{# data}
</body>
</html>
