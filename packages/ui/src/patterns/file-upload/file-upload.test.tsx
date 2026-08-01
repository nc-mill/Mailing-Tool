import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileUpload } from './file-upload';

const labels = {
  dropzone: 'Přetáhněte sem soubor',
  chooseFile: 'Vyberte ze složky',
  fileInput: 'Soubor k nahrání',
  cancel: 'Zrušit nahrávání',
  progress: (percent: number) => `Nahráno ${percent} %`,
  tooLarge: (limit: string) => `Soubor je větší než ${limit}.`,
  wrongType: 'Tenhle typ souboru neumíme přečíst.',
  selectedFile: (name: string) => `Vybraný soubor: ${name}`,
};

function csv(name = 'kontakty.csv', bytes = 20, type = 'text/csv') {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('FileUpload', () => {
  it('má klávesově dostupné tlačítko na výběr souboru, nejen přetažení', async () => {
    // WCAG 2.2, kritérium 2.5.7: co jde tažením, musí jít i bez něj.
    // Popisek `<label>` tuhle podmínku nesplňuje, protože nemá roli tlačítka
    // a čtečka ho jako akci neohlásí. Proto je tu skutečné `<button>`.
    const user = userEvent.setup();
    render(<FileUpload labels={labels} accept=".csv,text/csv" maxBytes={1000} onFile={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Vyberte ze složky' });
    await user.tab();
    expect(button).toHaveFocus();
    expect(button).not.toHaveAttribute('disabled');
  });

  it('fokus na tlačítku je vidět, protože obrys je na něm, ne na sourozenci', async () => {
    const user = userEvent.setup();
    render(<FileUpload labels={labels} accept=".csv" maxBytes={1000} onFile={vi.fn()} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Vyberte ze složky' }).className).toContain(
      'focus-visible:outline',
    );
  });

  it('tlačítko otevře dialog na výběr souboru', async () => {
    const user = userEvent.setup();
    render(<FileUpload labels={labels} accept=".csv" maxBytes={1000} onFile={vi.fn()} />);
    const input = screen.getByLabelText('Soubor k nahrání') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    await user.click(screen.getByRole('button', { name: 'Vyberte ze složky' }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('vstupní pole není v pořadí fokusu, aby tabulátor padl na tlačítko', () => {
    render(<FileUpload labels={labels} accept=".csv" maxBytes={1000} onFile={vi.fn()} />);
    expect(screen.getByLabelText('Soubor k nahrání')).toHaveAttribute('tabindex', '-1');
  });

  it('výběr souboru přes vstupní pole zavolá obsluhu', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    render(<FileUpload labels={labels} accept=".csv,text/csv" maxBytes={1000} onFile={onFile} />);

    await user.upload(screen.getByLabelText('Soubor k nahrání'), csv());
    expect(onFile).toHaveBeenCalledTimes(1);
    expect((onFile.mock.calls[0]?.[0] as File | undefined)?.name).toBe('kontakty.csv');
  });

  it('přijme CSV z Windows, které chodí s jiným nebo prázdným typem', async () => {
    // Hlavní scénář importu. Windows u .csv posílá application/vnd.ms-excel,
    // někdy prázdný řetězec. Kontrola jen podle MIME typu by odmítla
    // většinu skutečných souborů, se kterými uživatelé přijdou.
    const user = userEvent.setup();
    const onFile = vi.fn();
    render(<FileUpload labels={labels} accept=".csv,text/csv" maxBytes={1000} onFile={onFile} />);
    const input = screen.getByLabelText('Soubor k nahrání');

    await user.upload(input, csv('z-excelu.csv', 20, 'application/vnd.ms-excel'));
    await user.upload(input, csv('bez-typu.csv', 20, ''));

    expect(onFile).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('soubor s nepovolenou příponou i typem odmítne', async () => {
    // `applyAccept: false`, protože testing-library by jinak soubor sám
    // vyfiltroval podle atributu `accept` dřív, než by ho vůbec dostala
    // komponenta. To by otestovalo knihovnu, ne naši vlastní kontrolu.
    // V reálném prohlížeči jde stejně obejít přetažením nebo volbou
    // „Všechny soubory" v dialogu, takže vlastní kontrola musí platit i tak.
    const user = userEvent.setup({ applyAccept: false });
    const onFile = vi.fn();
    render(<FileUpload labels={labels} accept=".csv,text/csv" maxBytes={1000} onFile={onFile} />);

    await user.upload(screen.getByLabelText('Soubor k nahrání'), csv('foto.png', 20, 'image/png'));
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Tenhle typ souboru neumíme přečíst.');
  });

  it('přetažení souboru na plochu zavolá stejnou obsluhu', () => {
    const onFile = vi.fn();
    render(<FileUpload labels={labels} accept=".csv" maxBytes={1000} onFile={onFile} />);

    const zone = screen.getByTestId('dropzone');
    const dataTransfer = { files: [csv()], items: [], types: ['Files'] };
    zone.dispatchEvent(Object.assign(new Event('drop', { bubbles: true }), { dataTransfer }));
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('soubor přes limit odmítne s uvedením limitu', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    render(<FileUpload labels={labels} accept=".csv" maxBytes={10} onFile={onFile} />);

    await user.upload(screen.getByLabelText('Soubor k nahrání'), csv('velky.csv', 500));
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Soubor je větší než');
  });

  it('průběh hlásí v procentech a má i textovou podobu', () => {
    render(
      <FileUpload
        labels={labels}
        accept=".csv"
        maxBytes={1000}
        onFile={vi.fn()}
        progress={42}
        onCancel={vi.fn()}
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', 'Nahráno 42 %');
    expect(screen.getByRole('button', { name: 'Zrušit nahrávání' })).toBeVisible();
  });

  it('když dostane sendChunk, nahraje soubor po částech sama', async () => {
    // Vada, kterou tenhle test hlídá: `uploadInChunks` byla hotová
    // a otestovaná, ale komponenta ji nikdy nezavolala. Soubor o 200 MB
    // by se poslal jedním požadavkem.
    const user = userEvent.setup();
    const sent: number[] = [];
    render(
      <FileUpload
        labels={labels}
        accept=".csv"
        maxBytes={1_000_000}
        onFile={vi.fn()}
        chunkSize={10}
        sendChunk={async ({ index }) => {
          sent.push(index);
        }}
      />,
    );

    await user.upload(screen.getByLabelText('Soubor k nahrání'), csv('kontakty.csv', 25));
    await waitFor(() => expect(sent).toEqual([0, 1, 2]));
  });

  it('zrušení během nahrávání po částech zastaví další části', async () => {
    const user = userEvent.setup();
    let sentCount = 0;
    render(
      <FileUpload
        labels={labels}
        accept=".csv"
        maxBytes={1_000_000}
        onFile={vi.fn()}
        chunkSize={10}
        sendChunk={async () => {
          sentCount += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }}
      />,
    );

    await user.upload(screen.getByLabelText('Soubor k nahrání'), csv('kontakty.csv', 100));
    await screen.findByRole('button', { name: 'Zrušit nahrávání' });
    await user.click(screen.getByRole('button', { name: 'Zrušit nahrávání' }));

    const afterCancel = sentCount;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(sentCount).toBe(afterCancel);
  });

  it('velký soubor předá jako File, nenačítá ho do paměti', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    render(<FileUpload labels={labels} accept=".csv" maxBytes={209_715_200} onFile={onFile} />);

    const big = csv('big.csv', 1024);
    Object.defineProperty(big, 'size', { value: 209_715_200 });
    await user.upload(screen.getByLabelText('Soubor k nahrání'), big);

    expect(onFile).toHaveBeenCalledWith(expect.any(File));
  });
});
