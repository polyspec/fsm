<article class="machine">
<h1>{= machine}</h1>
<p><a href="/">All machines</a></p>
{+ errors.tpl}
<p><a href="/machines/{= machine}/edit">Edit</a> · <a href="/machines/{= machine}/rename">Rename states</a></p>
<form method="post" action="/machines/{= machine}/delete"><input type="hidden" name="_csrf" value="{= csrf}"><button type="submit">Delete machine</button></form>
<h2>States</h2>
<table>
<thead><tr><th>Key</th><th>Code</th><th>Initial</th><th>Final</th></tr></thead>
<tbody>
{@ state = states}
<tr><td>{= state.key}</td><td>{= state.code}</td><td>{? state.initial}yes{:}-{/}</td><td>{? state.final}yes{:}-{/}</td></tr>
{:}
<tr><td colspan="4" class="notice">No states.</td></tr>
{/}
</tbody>
</table>
<h2>Events</h2>
<table>
<thead><tr><th>Event</th><th>From</th><th>To</th></tr></thead>
<tbody>
{@ event = events}
{@ edge = event.edges}
<tr><td>{= event.key}</td><td>{= edge.from}</td><td>{= edge.to}</td></tr>
{/}
{:}
<tr><td colspan="3" class="notice">No events.</td></tr>
{/}
</tbody>
</table>
<h2>Diagram</h2>
{? showDiagram}<pre class="mermaid">{= mermaid}</pre>
{:}<p class="notice">The diagram is not shown while the machine has errors.</p>
{/}
</article>
