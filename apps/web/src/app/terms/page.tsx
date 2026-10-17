import { LegalDocShell, LegalSection } from "@/components/legal/legal-doc-shell";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

export const metadata = {
  title: "Kjøpsvilkår",
  description: "Kjøpsvilkår for billetter kjøpt via Ticketly",
};

export default function TermsPage() {
  return (
    <LegalDocShell title="Kjøpsvilkår" version={LEGAL_VERSIONS.terms}>
      <p>
        Disse vilkårene gjelder når du kjøper billetter via Ticketly-plattformen. Den konkrete
        avtaleparten (selger) for hver billett fremgår i kassen, på kvitteringen og i
        ordrebekreftelsen.
      </p>

      <LegalSection number={1} title="Om Ticketly">
        <p>
          Ticketly er en digital billettplattform som formidler salg av billetter til arrangementer.
          Ticketly er normalt ikke selger av billetten med mindre dette er uttrykkelig angitt for
          det aktuelle arrangementet.
        </p>
      </LegalSection>

      <LegalSection number={2} title="Avtalepart / selger">
        <p>
          Selger av billetten er den organisasjonen som er oppgitt som selger i kassen (juridisk
          navn, organisasjonsnummer og kontaktopplysninger der dette er tilgjengelig). Ticketly
          stiller teknisk plattform til rådighet for salg, betaling og billettleveranse.
        </p>
      </LegalSection>

      <LegalSection number={3} title="Kjøp av billett">
        <p>
          Når du fullfører betalingen og betalingen er bekreftet, inngås en bindende avtale om kjøp
          av billettene du har valgt. En reservasjon eller success-side alene er ikke bevis for
          betaling.
        </p>
      </LegalSection>

      <LegalSection number={4} title="Pris og gebyrer">
        <p>
          Pris, eventuelle serviceavgifter og totalbeløp vises før betaling. Beløp oppgis i den
          valutaen som er angitt for arrangementet. Eventuelle bank- eller valutagebyrer hos din
          betalingsformidler er utenfor Ticketlys kontroll.
        </p>
      </LegalSection>

      <LegalSection number={5} title="Betaling">
        <p>
          Betaling håndteres av en lisensiert betalingsleverandør. Ticketly lagrer ikke
          kortnummer eller CVV. Betalingen er først gyldig når Ticketly har mottatt bekreftet
          betalingsstatus fra leverandøren.
        </p>
      </LegalSection>

      <LegalSection number={6} title="Levering av billett">
        <p>
          Digitale billetter leveres via sikker lenke i ordrebekreftelsen og/eller i din Ticketly-
          konto. E-post er et varsel — billettene er tilgjengelige via ordre-/konto-lenke også hvis
          e-posten ikke kommer frem. QR-kode eller tilsvarende brukes for inngangskontroll.
        </p>
      </LegalSection>

      <LegalSection number={7} title="Aldersgrense og legitimasjon">
        <p>
          Der arrangementet har aldersgrense, gjelder kravet den som bruker billetten ved inngang —
          ikke nødvendigvis kjøperen. Gyldig legitimasjon kan bli krevd. Døransvarlig avgjør
          adgang. Ticketly verifiserer ikke alder via kryss i kassen.
        </p>
      </LegalSection>

      <LegalSection number={8} title="Billettens gyldighet">
        <p>
          En billett er gyldig for det angitte arrangementet, billettypen og antallet adganger som
          følger av kjøpet. Brukt, refundert, kansellert eller overført billett er ikke gyldig for
          ny inngang med mindre arrangør uttrykkelig tillater det.
        </p>
      </LegalSection>

      <LegalSection number={9} title="Overføring av billett">
        <p>
          Dersom overføring er aktivert, kan billetten overføres til en annen person i henhold til
          funksjonen i Ticketly. Alders- og legitimasjonskrav følger den som bruker billetten.
          Overført billett kan miste gyldighet for opprinnelig innehaver.
        </p>
      </LegalSection>

      <LegalSection number={10} title="Refusjon">
        <p>
          Refusjon følger refusjonspolicyen for arrangementet og gjeldende rett. Se egen side for{" "}
          <a href="/refund-policy" className="text-[color:var(--accent-soft)] hover:underline">
            Refusjonspolicy
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection number={11} title="Avlyst eller flyttet arrangement">
        <p>
          Ved avlysning, flytting eller vesentlig endring gjelder arrangørens policy og forbrukerrett
          der det er aktuelt. Ticketly formidler informasjon og refusjonsprosess der systemet
          støtter det.
        </p>
      </LegalSection>

      <LegalSection number={12} title="Angrerett">
        <p>
          Billetter til arrangementer på en bestemt dato eller i et bestemt tidsrom er normalt
          unntatt fra angreretten etter angrerettloven § 22 bokstav m. Det betyr at du vanligvis ikke
          kan angre kjøpet bare fordi du ombestemmer deg.
        </p>
      </LegalSection>

      <LegalSection number={13} title="Misbruk / videresalg / falske billetter">
        <p>
          Uautorisert videresalg, forfalskning, deling av QR-kode som muliggjør misbruk, eller annen
          omgåelse av inngangskontroll er forbudt. Brudd kan føre til at billetten blir ugyldiggjort
          uten refusjon.
        </p>
      </LegalSection>

      <LegalSection number={14} title="Teknisk feil">
        <p>
          Ved teknisk feil som hindrer levering av gyldig billett etter bekreftet betaling, skal
          feilen rettes eller kjøpet håndteres i tråd med refusjonspolicy og selgers plikter.
        </p>
      </LegalSection>

      <LegalSection number={15} title="Ansvarsbegrensning">
        <p>
          Ticketly er ikke ansvarlig for arrangementets innhold, gjennomføring, kvalitet eller
          endringer som ligger hos arrangør/selger. Ticketlys ansvar er begrenset til plattformens
          tekniske funksjon, med de begrensninger som følger av ufravikelig lov.
        </p>
      </LegalSection>

      <LegalSection number={16} title="Personvern">
        <p>
          Behandling av personopplysninger er beskrevet i{" "}
          <a href="/privacy" className="text-[color:var(--accent-soft)] hover:underline">
            Personvernerklæringen
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection number={17} title="Kontakt">
        <p>
          For spørsmål om kjøpet, kontakt selgerens kundestøtte oppgitt på ordrebekreftelsen eller
          arrangementssiden. For tekniske spørsmål om Ticketly-plattformen, bruk kontaktinformasjon
          som er publisert i produktet for plattformstøtte.
        </p>
      </LegalSection>

      <LegalSection number={18} title="Endringer i vilkår">
        <p>
          Vilkårene kan oppdateres. Versjonen som gjelder for ditt kjøp er den som ble akseptert ved
          checkout og lagret på ordren.
        </p>
      </LegalSection>

      <LegalSection number={19} title="Lovvalg og tvisteløsning">
        <p>
          Vilkårene er underlagt norsk rett. Forbrukertvister kan bringes inn for Forbrukertilsynet /
          Forbrukerklageutvalget der det er relevant. Tvangsfullbyrdelse følger norske domstoler
          med mindre annet følger av ufravikelig lov.
        </p>
      </LegalSection>
    </LegalDocShell>
  );
}
