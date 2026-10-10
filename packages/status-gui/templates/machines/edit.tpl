<article class="machine">
<h1>Edit {= machine}</h1>
<p><a href="/machines/{= machine}">Back to {= machine}</a></p>
{+ errors.tpl}
{= form | raw}
</article>
<script type="application/json" id="status-form-state">{= state | raw}</script>
