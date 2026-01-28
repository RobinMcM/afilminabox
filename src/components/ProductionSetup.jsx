import { useState } from 'react';
import QRCodeDisplay from './QRCodeDisplay';

function ProductionSetup({ session, qrCodes, cameras, onUpdateSession }) {
  const [filmGuid, setFilmGuid] = useState('');
  const [productionGuid, setProductionGuid] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsUpdating(true);
    
    await onUpdateSession(
      filmGuid || session.filmGuid,
      productionGuid || session.productionCompanyGuid
    );
    
    setFilmGuid('');
    setProductionGuid('');
    setIsUpdating(false);
  };
  
  return (
    <section className="production-setup">
      <div 
        className="setup-section-header" 
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h2 className="section-title">Production Setup</h2>
        <button 
          type="button"
          className="collapse-toggle"
          aria-label={isExpanded ? 'Collapse production setup' : 'Expand production setup'}
        >
          <span className={`toggle-icon ${isExpanded ? 'expanded' : 'collapsed'}`}>
            ▼
          </span>
        </button>
      </div>
      
      <div className={`setup-collapsible ${isExpanded ? 'expanded' : 'collapsed'}`}>
        <form className="session-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="filmGuid">Film GUID</label>
              <input
                type="text"
                id="filmGuid"
                value={filmGuid}
                onChange={(e) => setFilmGuid(e.target.value)}
                placeholder={session.filmGuid}
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="productionGuid">Production Company GUID</label>
              <input
                type="text"
                id="productionGuid"
                value={productionGuid}
                onChange={(e) => setProductionGuid(e.target.value)}
                placeholder={session.productionCompanyGuid}
                className="form-input"
              />
            </div>
          </div>
          
          <button type="submit" className="btn-primary" disabled={isUpdating}>
            {isUpdating ? 'Updating...' : 'Update Session & Regenerate QR Codes'}
          </button>
        </form>
        
        <div className="qr-section">
          <h3 className="subsection-title">Camera QR Codes</h3>
          <p className="qr-instructions">
            Scan these QR codes with your iPhone cameras to connect automatically
          </p>
          
          <div className="qr-grid">
            {[1, 2, 3].map((cameraId) => (
              <QRCodeDisplay
                key={cameraId}
                cameraId={cameraId}
                qrCode={qrCodes[cameraId]}
                connected={cameras[cameraId].connected}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default ProductionSetup;
