import { Migration } from '@mikro-orm/migrations';

export class Migration20261124182507 extends Migration {
  override name = 'Migration20261124182507';

  override up(): void | Promise<void> {
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_password_hash_length" check (char_length(password_hash) <= 72);`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "enrollments" drop constraint "enrollments_password_hash_length";`);
  }
}
