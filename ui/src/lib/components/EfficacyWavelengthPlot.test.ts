import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import EfficacyWavelengthPlot from './EfficacyWavelengthPlot.svelte';

describe('EfficacyWavelengthPlot', () => {
  const mockData = [
    {
      species: 'E. coli',
      strain: '',
      wavelength: 254,
      k1: 0.5,
      k2: 0.1,
      category: 'Bacteria',
      medium: 'Air',
      condition: '',
      reference: '',
      link: '',
      resistant_fraction: 0.0,
      each_uv: 10,
      seconds_to_99: 10,
    },
  ];

  it('renders SVG element with data', () => {
    const { container } = render(EfficacyWavelengthPlot, { props: { filteredData: mockData } });
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders placeholder with empty data', () => {
    render(EfficacyWavelengthPlot, { props: { filteredData: [] } });
    expect(screen.getByText(/No data/i)).toBeTruthy();
  });

  it('renders axis labels', () => {
    render(EfficacyWavelengthPlot, { props: { filteredData: mockData } });
    expect(screen.getByText(/Wavelength/)).toBeTruthy();
  });

  it('has k1/k2 toggle checkbox', () => {
    const { container } = render(EfficacyWavelengthPlot, { props: { filteredData: mockData } });
    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
  });
});
