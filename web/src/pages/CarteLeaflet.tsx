import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { PointCarteWeb } from '../api.js';

// The map itself. Loaded on demand (it is the only user of Leaflet): the page that shows it
// decides what is selected and in which order, this component only draws it.
export default function CarteLeaflet({
  points,
  ordre,
  trace,
  onBasculer,
}: {
  points: PointCarteWeb[];
  // Ids of the chosen companies, in visiting order: their markers are numbered.
  ordre: string[];
  trace: [number, number][] | null;
  onBasculer: (id: string) => void;
}) {
  const conteneur = useRef<HTMLDivElement>(null);
  const carte = useRef<L.Map | null>(null);
  const calque = useRef<L.LayerGroup | null>(null);
  const cadree = useRef(false);

  useEffect(() => {
    if (!conteneur.current || carte.current) return;
    const c = L.map(conteneur.current).setView([46.6, 2.4], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(c);
    calque.current = L.layerGroup().addTo(c);
    carte.current = c;
    return () => {
      c.remove();
      carte.current = null;
      calque.current = null;
      cadree.current = false;
    };
  }, []);

  useEffect(() => {
    const c = carte.current;
    const g = calque.current;
    if (!c || !g) return;
    g.clearLayers();
    if (trace && trace.length > 1)
      L.polyline(trace, { color: '#1d4ed8', weight: 4, opacity: 0.8 }).addTo(g);
    for (const p of points) {
      const rang = ordre.indexOf(p.id);
      const choisie = rang >= 0;
      const marqueur = choisie
        ? L.marker([p.latitude, p.longitude], {
            icon: L.divIcon({
              className: '',
              html: `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#1d4ed8;color:#fff;font:600 13px sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${rang + 1}</span>`,
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            }),
          })
        : L.circleMarker([p.latitude, p.longitude], {
            radius: 7,
            color: '#fff',
            weight: 2,
            fillColor: '#0f766e',
            fillOpacity: 0.9,
          });
      marqueur.bindTooltip(`${p.nom}${p.ville ? ` · ${p.ville}` : ''}`);
      marqueur.on('click', () => onBasculer(p.id));
      marqueur.addTo(g);
    }
    if (!cadree.current && points.length > 0) {
      c.fitBounds(
        L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number])),
        {
          padding: [30, 30],
          maxZoom: 13,
        },
      );
      cadree.current = true;
    }
  }, [points, ordre, trace, onBasculer]);

  return (
    <div
      ref={conteneur}
      className="bv-carte"
      role="application"
      aria-label="Carte des entreprises"
    />
  );
}
