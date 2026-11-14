import { entregarPagina } from '../../lib/pagina.js';

// Link de convite do personal: /c/rafa
export const onRequestGet = (contexto) => entregarPagina(contexto, '/convite');
