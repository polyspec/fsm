<article class="machine">
<h1>Edit {= machine}</h1>
<p><a href="/machines/{= machine}">Back to {= machine}</a></p>
{+ errors.tpl}
<div id="fsm-form">{= form | raw}</div>
</article>
<script type="application/json" id="fsm-form-state">{= state | raw}</script>
