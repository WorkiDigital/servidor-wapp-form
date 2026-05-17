/**
 * TrackServer SDK — exemplo genérico.
 *
 * Em produção, prefira carregar o snippet dinâmico servido pela API:
 * <script src="https://track.seudominio.com/snippet.js"></script>
 *
 * Este arquivo é apenas uma referência de integração.
 */
(function() {
  window.TrackServerConfig = window.TrackServerConfig || {
    autoPageView: true,
    autoCaptureForm: false,
    source_id: undefined,
    source_type: 'custom'
  };

  console.info('[TrackServer] Use /snippet.js do seu domínio de tracking para carregar o SDK dinâmico.');
})();
