import { Titulo } from '../componentes/titulo.js';
export function IngresarReal({ aviso }: { aviso?: string | undefined }) {
  return <><Titulo>Ingresar</Titulo><p>Accedé a tu cuenta con la identidad de la plataforma.</p>
    {aviso && <p role="alert">{aviso}</p>}
    <form method="post" action="/auth/iniciar"><button type="submit">Iniciar sesión con Keycloak</button></form>
  </>;
}
