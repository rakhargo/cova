import Image from 'next/image';
import styles from './cova-logo.module.css';
export function CovaLogo(){return <a className={styles.logo} href="#" aria-label="Cova home"><Image src="/cova-logo.png" alt="Cova" width={1254} height={1254} className={styles.image} sizes="144px"/></a>;}
