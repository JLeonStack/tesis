// Discourse markers for academic Spanish, grouped by what they do.
// `comma`: takes a comma after it when it opens a sentence ("Sin embargo, …").

export interface Connector {
  text: string
  comma: boolean
}

const c = (list: string, comma = true): Connector[] => list.split('|').map((text) => ({ text, comma }))

export const CONNECTOR_GROUPS: { label: string; hint: string; items: Connector[] }[] = [
  { label: 'Agregar', hint: 'Sumar una idea', items: c('además|asimismo|del mismo modo|por otra parte|a su vez|igualmente') },
  { label: 'Contrastar', hint: 'Oponer o matizar', items: [...c('sin embargo|no obstante|por el contrario|en cambio|aun así'), ...c('si bien|a pesar de que', false)] },
  { label: 'Causa', hint: 'Explicar por qué', items: c('dado que|puesto que|ya que|debido a que|habida cuenta de que', false) },
  { label: 'Consecuencia', hint: 'Mostrar el efecto', items: [...c('por lo tanto|en consecuencia|por consiguiente|así pues'), ...c('de ahí que|de modo que', false)] },
  { label: 'Ejemplificar', hint: 'Ilustrar', items: [...c('por ejemplo|en particular|a modo de ilustración'), ...c('tal es el caso de', false)] },
  { label: 'Aclarar', hint: 'Reformular', items: c('es decir|en otras palabras|dicho de otro modo|esto es') },
  { label: 'Ordenar', hint: 'Secuenciar', items: c('en primer lugar|en segundo lugar|a continuación|por último|finalmente') },
  { label: 'Comparar', hint: 'Relacionar', items: [...c('de manera similar|análogamente|en contraste'), ...c('en comparación con|a diferencia de', false)] },
  { label: 'Concluir', hint: 'Cerrar o sintetizar', items: c('en síntesis|en suma|en definitiva|en conclusión|para concluir') },
  { label: 'Enfatizar', hint: 'Destacar', items: c('en efecto|de hecho|sobre todo|especialmente') }
]
