import { entregarPagina } from '../../lib/pagina.js';

// Link pessoal do aluno: /a/<código>
export const onRequestGet = (contexto) => entregarPagina(contexto, '/aluno');
