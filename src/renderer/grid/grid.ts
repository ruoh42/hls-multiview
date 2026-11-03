import { api } from '../common/api';
import { mountGrid } from './player';

const render = mountGrid({
  container: document.getElementById('tiles') as HTMLDivElement,
  empty: document.getElementById('empty') as HTMLParagraphElement,
  send: api.send,
});

api.onTiles(render);
void api.getTiles().then(render);
