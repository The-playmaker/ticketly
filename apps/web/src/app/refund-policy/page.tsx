import { LegalDocShell, LegalSection } from "@/components/legal/legal-doc-shell";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

export const metadata = {
  title: "Refusjonspolicy",
  description: "Refusjonspolicy for billetter kjøpt via Ticketly",
};

export default function RefundPolicyPage() {
  return (
    <LegalDocShell title="Refusjonspolicy" version={LEGAL_VERSIONS.refundPolicy}>
      <p>
        Denne policyen beskriver hovedreglene for refusjon. Arrangør/selger kan ha mer detaljerte
        regler for sitt arrangement; disse vises der de er konfigurert. Ticketly formidler
        refusjoner gjennom betalingsleverandøren når systemet støtter det.
      </p>

      <LegalSection number={1} title="Hovedregel">
        <p>
          Billetter til arrangementer på en bestemt dato eller i et bestemt tidsrom er normalt
          unntatt fra angreretten. Billetter er derfor vanligvis ikke refunderbare fordi du
          ombestemmer deg.
        </p>
      </LegalSection>

      <LegalSection number={2} title="A. Kunden ombestemmer seg">
        <p>Som hovedregel gis det ikke refusjon ved ombestemmelse.</p>
      </LegalSection>

      <LegalSection number={3} title="B. Arrangementet avlyses">
        <p>
          Ved avlysning skal refusjon normalt følge arrangørens policy og gjeldende rett. Pengene
          tilbakebetales til samme betalingsmåte der dette er mulig.
        </p>
      </LegalSection>

      <LegalSection number={4} title="C. Arrangementet flyttes">
        <p>
          Ved flytting/endring av tidspunkt gjelder arrangørens regler. I noen tilfeller kan du ha
          rettigheter etter forbrukerregelverket. Følg informasjon fra arrangør.
        </p>
      </LegalSection>

      <LegalSection number={5} title="D. Vesentlig endring">
        <p>
          Ved vesentlig endring av arrangementet kan arrangør tilby refusjon, ombooking eller annen
          kompensasjon etter egen policy og gjeldende rett.
        </p>
      </LegalSection>

      <LegalSection number={6} title="E. Dobbeltkjøp">
        <p>
          Ved dokumentert dobbeltkjøp forårsaket av teknisk feil, kan den ekstra ordren refunderes
          etter verifisering.
        </p>
      </LegalSection>

      <LegalSection number={7} title="F. Betalingsfeil">
        <p>
          Hvis du er belastet uten at billetter er utstedt, eller beløpet er feil, kontakt support
          med ordrenummer. Feil korrigeres etter verifisering.
        </p>
      </LegalSection>

      <LegalSection number={8} title="G. Delrefusjon">
        <p>
          Delrefusjon kan forekomme for enkelte billetter i en ordre, der arrangør/selger tillater
          det og systemet støtter det.
        </p>
      </LegalSection>

      <LegalSection number={9} title="H. Billett allerede brukt">
        <p>Billetter som er sjekket inn / brukt refunderes normalt ikke.</p>
      </LegalSection>

      <LegalSection number={10} title="I. Overført billett">
        <p>
          Etter overføring følger refusjonsregler den aktive billettinnehaveren og arrangørens
          policy. Overføring kan begrense refusjonsmuligheter.
        </p>
      </LegalSection>

      <LegalSection number={11} title="J. Arrangørspesifikk policy">
        <p>
          Arrangør kan angi egen refusjonstekst for arrangementet. Der den er strengere eller mer
          spesifikk enn denne generelle policyen, gjelder den for det aktuelle kjøpet i den
          utstrekning loven tillater.
        </p>
      </LegalSection>

      <LegalSection number={12} title="Serviceavgifter">
        <p>
          Om serviceavgift refunderes ved avlysning eller annen refusjon, fremgår av arrangørens
          oppsett og kvitteringen. Ikke anta at alle avgifter alltid refunderes.
        </p>
      </LegalSection>

      <LegalSection number={13} title="Når refusjonen er endelig">
        <p>
          En refusjon er først endelig når betalingsleverandøren har bekreftet den. Tilbakebetaling
          sendes til samme betalingsmåte der dette er mulig. Tiden det tar før beløpet er synlig på
          konto, avhenger av bank/betalingsleverandør.
        </p>
      </LegalSection>

      <LegalSection number={14} title="Kontakt">
        <p>
          Bruk ordrenummeret og kontaktinformasjonen på ordrebekreftelsen. For tekniske problemer
          med plattformen, kontakt Ticketly-plattformstøtte der den er publisert.
        </p>
      </LegalSection>
    </LegalDocShell>
  );
}
