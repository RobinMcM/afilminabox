function ClapperBoard() {
  return (
    <section className="clapperboard-section">
      <h2 className="clapperboard-section-title">Slate</h2>
      <div className="clapperboard">
        <div className="clapperboard-surround">
          <div className="clapperboard-clapper" aria-hidden="true">
            <div className="clapperboard-clapper-stripes" />
          </div>
          <div className="clapperboard-panel">
            <div className="clapperboard-fields">
              <div className="clapperboard-row clapperboard-row-single">
                <div className="clapperboard-field">
                  <span className="clapperboard-field-label">Production</span>
                  <span className="clapperboard-field-value">—</span>
                </div>
              </div>
              <div className="clapperboard-row clapperboard-row-triple">
                <div className="clapperboard-field">
                  <span className="clapperboard-field-label">Scene</span>
                  <span className="clapperboard-field-value">—</span>
                </div>
                <div className="clapperboard-field">
                  <span className="clapperboard-field-label">Take</span>
                  <span className="clapperboard-field-value clapperboard-field-value-empty">—</span>
                </div>
                <div className="clapperboard-field">
                  <span className="clapperboard-field-label">Roll</span>
                  <span className="clapperboard-field-value">—</span>
                </div>
              </div>
              <div className="clapperboard-row clapperboard-row-triple">
                <div className="clapperboard-field">
                  <span className="clapperboard-field-label">Director</span>
                  <span className="clapperboard-field-value">—</span>
                </div>
                <div className="clapperboard-field">
                  <span className="clapperboard-field-label">Date</span>
                  <span className="clapperboard-field-value">—</span>
                </div>
                <div className="clapperboard-field">
                  <span className="clapperboard-field-label">Camera</span>
                  <span className="clapperboard-field-value">—</span>
                </div>
              </div>
            </div>
          </div>
          <p className="clapperboard-hosted">Hosted by MovieShaker</p>
        </div>
      </div>
    </section>
  );
}

export default ClapperBoard;
