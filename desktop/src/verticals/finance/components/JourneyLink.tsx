import { Link, useLocation, type LinkProps } from 'react-router-dom';
import { journeyHref } from '../lib/workspaceJourney';
/** A deliberate next step, with explicit context and a safe source return. */
export function JourneyLink({context,...props}: LinkProps & {context?: {symbol?: string;date?: string}}) {
  const {pathname,search,hash} = useLocation();
  return <Link {...props} to={typeof props.to === 'string' ? journeyHref(props.to,pathname,search,{...context,hash}) : props.to} />;
}
