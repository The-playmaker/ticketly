import { LegalDocShell, LegalSection } from "@/components/legal/legal-doc-shell";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

export const metadata = {
  title: "Personvernerklæring",
  description: "Personvernerklæring for Ticketly",
};

export default function PrivacyPage() {
  return (
    <LegalDocShell title="Personvernerklæring" version={LEGAL_VERSIONS.privacy}>
      <p>
        Denne erklæringen forklarer hvordan personopplysninger behandles når du bruker Ticketly.
        Hvem som er behandlingsansvarlig kan variere mellom plattform og arrangør/selger.
      </p>

      <LegalSection number={1} title="Hvem vi er">
        <p>
          Ticketly er en billettplattform. Arrangører bruker Ticketly til å selge billetter til sine
          arrangementer.
        </p>
      </LegalSection>

      <LegalSection number={2} title="Hvem som er behandlingsansvarlig">
        <p>
          Ticketly (plattformoperatør) er typisk behandlingsansvarlig for konto, innlogging,
          sikkerhet, driftslogger og plattformfunksjoner. Arrangør/selger er typisk
          behandlingsansvarlig for kunde- og billettopplysninger knyttet til sitt arrangement.
          Konkret ansvarsfordeling kan følge av databehandleravtale mellom partene.
        </p>
      </LegalSection>

      <LegalSection number={3} title="Hvilke personopplysninger vi samler inn">
        <p>
          Typisk: navn, e-post, telefon (valgfritt), ordre- og billettinformasjon, betalingstatus
          (ikke kortnummer), sjekk-in-status, og tekniske logger som er nødvendige for sikkerhet og
          support. Vi ber ikke om fødselsdato eller nasjonalt ID-nummer som standard.
        </p>
      </LegalSection>

      <LegalSection number={4} title="Hvorfor vi behandler data">
        <p>
          For å gjennomføre kjøp, utstede billetter, sende ordre-/billettvarsler, håndtere
          refusjon, forhindre misbruk, og gi kundestøtte.
        </p>
      </LegalSection>

      <LegalSection number={5} title="Behandlingsgrunnlag">
        <p>
          Avtale (kjøp/billett), berettiget interesse (sikkerhet, misbrukskontroll, drift),
          rettslig forpliktelse der det gjelder, og samtykke der det er relevant (f.eks. markedsføring).
        </p>
      </LegalSection>

      <LegalSection number={6} title="Betaling">
        <p>
          Kort- og kontodetaljer behandles av betalingsleverandøren. Ticketly mottar typisk kun
          bekreftelse, beløp, status og referanser som trengs for ordre og refusjon.
        </p>
      </LegalSection>

      <LegalSection number={7} title="Arrangører">
        <p>
          Arrangør/selger får tilgang til ordre-, billett- og sjekk-in-data for sitt arrangement for
          å gjennomføre arrangementet og støtte kunder.
        </p>
      </LegalSection>

      <LegalSection number={8} title="E-post/SMS">
        <p>
          Transaksjonsmeldinger (ordre, billetter, refusjon) sendes fordi de er nødvendige for
          tjenesten. Markedsføring krever separat samtykke og er ikke forhåndskrysset.
        </p>
      </LegalSection>

      <LegalSection number={9} title="Scanner/check-in">
        <p>
          Ved inngang brukes billettidentifikator og begrenset visning (f.eks. navn, billettype,
          alderskrav). Vi viser ikke unødvendige personopplysninger på skanneren.
        </p>
      </LegalSection>

      <LegalSection number={10} title="Analytics">
        <p>
          Vi kan behandle begrenset bruksstatistikk for å forbedre produktet. Der det brukes
          tredjepartsanalyse, skal det konfigureres i tråd med personvernregelverket.
        </p>
      </LegalSection>

      <LegalSection number={11} title="Cookies">
        <p>
          Nødvendige cookies brukes for innlogging, sikkerhet og kasse. Eventuelle ikke-nødvendige
          cookies krever samtykke der loven krever det.
        </p>
      </LegalSection>

      <LegalSection number={12} title="Databehandlere">
        <p>
          Vi bruker underleverandører for drift, e-post, betaling og hosting. Leverandører bindes av
          databehandleravtaler der det er påkrevd. Konkrete leverandører avhenger av miljøkonfigurasjon.
        </p>
      </LegalSection>

      <LegalSection number={13} title="Overføring utenfor EØS">
        <p>
          Dersom data overføres utenfor EØS, skjer det med lovlige overføringsgrunnlag (f.eks.
          standardkontraktsklausuler) der det er aktuelt.
        </p>
      </LegalSection>

      <LegalSection number={14} title="Lagringstid">
        <p>
          Data lagres så lenge det er nødvendig for ordre, billetter, regnskap, reklamasjon,
          sikkerhet og lovpålagte plikter, og deretter slettes eller anonymiseres.
        </p>
      </LegalSection>

      <LegalSection number={15} title="Sikkerhet">
        <p>
          Vi bruker tekniske og organisatoriske tiltak som tilgangskontroll, kryptering i transit,
          og begrenset logging. QR-tokens behandles som hemmeligheter.
        </p>
      </LegalSection>

      <LegalSection number={16} title="Rettigheter">
        <p>
          Du har rettigheter etter personvernforordningen (GDPR), herunder innsyn, retting,
          sletting, begrensning, protest og dataportabilitet der vilkårene er oppfylt.
        </p>
      </LegalSection>

      <LegalSection number={17} title="Innsyn">
        <p>Du kan be om innsyn i personopplysninger som behandles om deg.</p>
      </LegalSection>

      <LegalSection number={18} title="Retting">
        <p>Du kan be om at uriktige opplysninger rettes.</p>
      </LegalSection>

      <LegalSection number={19} title="Sletting">
        <p>
          Du kan be om sletting der det ikke finnes et lovlig grunnlag for videre lagring (f.eks.
          regnskapsplikt).
        </p>
      </LegalSection>

      <LegalSection number={20} title="Begrensning">
        <p>Du kan i visse tilfeller be om begrenset behandling.</p>
      </LegalSection>

      <LegalSection number={21} title="Protest">
        <p>
          Du kan protestere mot behandling basert på berettiget interesse der vilkårene er oppfylt.
        </p>
      </LegalSection>

      <LegalSection number={22} title="Dataportabilitet">
        <p>Der behandlingen baseres på avtale eller samtykke og er automatisert, kan du be om dataportabilitet.</p>
      </LegalSection>

      <LegalSection number={23} title="Klage til Datatilsynet">
        <p>
          Du kan klage til Datatilsynet dersom du mener behandlingen er i strid med
          personvernregelverket.
        </p>
      </LegalSection>

      <LegalSection number={24} title="Kontakt">
        <p>
          Kontakt selgerens kundestøtte for spørsmål knyttet til et konkret kjøp/arrangement. For
          plattformrelaterte personvernspørsmål, bruk kontaktinformasjon publisert for Ticketly-
          plattformen.
        </p>
      </LegalSection>

      <LegalSection number={25} title="Endringer">
        <p>
          Erklæringen kan oppdateres. Versjonen som gjelder for ditt kjøp lagres sammen med
          ordre-/samtykkeregistreringen der det er relevant.
        </p>
      </LegalSection>
    </LegalDocShell>
  );
}
