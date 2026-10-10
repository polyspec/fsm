{? hasFindings}<section class="errors" role="alert">
<h2>Errors</h2>
<ul>
{@ finding = findings}
<li><code>{= finding.code}</code>{? finding.machine} <strong>{= finding.machine}</strong>{/} <code>{= finding.path}</code>: {= finding.message}</li>
{/}
</ul>
</section>
{/}
