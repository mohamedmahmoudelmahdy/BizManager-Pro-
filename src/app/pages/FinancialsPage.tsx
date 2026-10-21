import { Navigate } from 'react-router-dom';

/** @deprecated Use CustomerFinancialsPage at /customers/financials */
export function FinancialsPage() {
  return <Navigate to="/customers/financials" replace />;
}
