import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { NODE_DASHBOARD_OPEN_EVENT } from '@/lib/p2p/nodeDashboardEvents';

export function NodeDashboardEventBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = () => {
      navigate('/node-dashboard');
    };
    window.addEventListener(NODE_DASHBOARD_OPEN_EVENT, handler);
    return () => {
      window.removeEventListener(NODE_DASHBOARD_OPEN_EVENT, handler);
    };
  }, [navigate]);

  return null;
}
