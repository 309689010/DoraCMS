import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm'

@Entity('post')
export class Post {
  @PrimaryGeneratedColumn()
  id = undefined

  @Column({
    name: 'abc_ddd',
    type: 'varchar'
  })
  abcDdd = undefined

  @Column('varchar')
  title = ''

  @Column('text')
  text = ''
}
